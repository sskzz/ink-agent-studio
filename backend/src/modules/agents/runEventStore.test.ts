import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeDatabase } from "../../runtime/database/runtimeDatabase.js";
import { createWorkspacePaths } from "../workspace/workspacePaths.js";
import { ensureWorkspace } from "../workspace/workspaceService.js";
import { RunEventStore } from "./runEventStore.js";

let tempRoot: string | null = null;
let runtimeDatabase: RuntimeDatabase | null = null;

afterEach(async () => {
  runtimeDatabase?.close();
  runtimeDatabase = null;
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

async function createStore() {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-events-"));
  const paths = createWorkspacePaths(tempRoot);
  await ensureWorkspace(paths);
  runtimeDatabase = new RuntimeDatabase(paths);
  await runtimeDatabase.initialize({ busyTimeoutMs: 1_000, backupBeforeMigration: false });
  return new RunEventStore(runtimeDatabase);
}

function command() {
  return {
    schemaVersion: "run-command.v1" as const,
    type: "continue_chapter" as const,
    bookId: "book-1",
    chapterId: "chapter-1",
    input: {
      instruction: "继续写",
      selectedContextFileIds: [],
      sceneType: "auto",
      allowDegradedStyle: false
    }
  };
}

describe("RunEventStore", () => {
  it("atomically appends events and projects the run snapshot", async () => {
    const store = await createStore();
    const created = store.createRun({ command: command(), configRevision: 3, configHash: "config-hash" });
    expect(created.status).toBe("queued");
    expect(created.lastEventSeq).toBe(1);

    store.appendEvent(created.id, { type: "run_started", payload: {} });
    store.appendEvent(created.id, { type: "stage_started", stage: "generate", payload: {} });
    const completed = store.appendEvent(created.id, {
      type: "run_completed",
      payload: { output: { draft: "正文" } }
    });

    expect(completed.snapshot).toMatchObject({
      status: "completed",
      currentStage: null,
      output: { draft: "正文" },
      lastEventSeq: 4
    });
    expect(store.listEvents(created.id).map((event) => event.type)).toEqual([
      "run_created",
      "run_queued",
      "run_started",
      "stage_started",
      "run_completed"
    ]);
  });

  it("rejects invalid transitions without leaving a partial event", async () => {
    const store = await createStore();
    const created = store.createRun({ command: command(), configRevision: 1, configHash: "config-hash" });

    expect(() => store.appendEvent(created.id, {
      type: "run_completed",
      payload: { output: null }
    })).toThrow("只有运行中的任务可以完成");
    expect(store.getRun(created.id).lastEventSeq).toBe(1);
    expect(store.listEvents(created.id)).toHaveLength(2);
  });

  it("deduplicates retries by eventId", async () => {
    const store = await createStore();
    const created = store.createRun({ command: command(), configRevision: 1, configHash: "config-hash" });
    const input = { eventId: "stable-start-event", type: "run_started" as const, payload: {} };

    const first = store.appendEvent(created.id, input);
    const retried = store.appendEvent(created.id, input);

    expect(retried.event).toEqual(first.event);
    expect(store.listEvents(created.id)).toHaveLength(3);
  });

  it("stores artifacts, checkpoints and model attempts with their events", async () => {
    const store = await createStore();
    const created = store.createRun({ command: command(), configRevision: 1, configHash: "config-hash" });
    store.appendEvent(created.id, { type: "run_started", payload: {} });
    store.appendEvent(created.id, { type: "stage_started", stage: "generate", payload: {} });

    const artifact = store.saveInlineArtifact(created.id, {
      artifactType: "draft",
      value: { content: "正文" }
    });
    const attempt = store.startModelAttempt(created.id, {
      stage: "generate",
      purpose: "writing",
      provider: "openai-compatible",
      model: "test-model",
      attemptNumber: 1,
      requestHash: "request-hash"
    });
    const completedAttempt = store.finishModelAttempt(attempt.id, {
      status: "completed",
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      estimatedCostMicros: 42,
      costCurrency: "USD",
      latencyMs: 50
    });
    const checkpoint = store.saveCheckpoint(created.id, {
      stage: "generate",
      checkpoint: { artifactId: artifact.id },
      resumable: true
    });

    expect(artifact).toMatchObject({ storageKind: "inline_json", byteSize: expect.any(Number) });
    expect(completedAttempt).toMatchObject({ status: "completed", totalTokens: 30, estimatedCostMicros: 42, costCurrency: "USD" });
    expect(store.listModelAttempts(created.id)).toEqual([completedAttempt]);
    expect(checkpoint).toMatchObject({ stage: "generate", resumable: true });
    expect(store.listEvents(created.id).map((event) => event.type)).toEqual(expect.arrayContaining([
      "model_attempt_started",
      "model_attempt_completed",
      "checkpoint_saved"
    ]));
  });
});

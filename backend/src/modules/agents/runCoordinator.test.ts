import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { EffectiveConfigResponse, RunCommand } from "@ink-agent/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { defaultAppConfig } from "../../config/defaultAppConfig.js";
import { RuntimeDatabase } from "../../runtime/database/runtimeDatabase.js";
import { createWorkspacePaths } from "../workspace/workspacePaths.js";
import { ensureWorkspace } from "../workspace/workspaceService.js";
import { RunCoordinator, type RunCommandHandler } from "./runCoordinator.js";
import { RunEventStore } from "./runEventStore.js";

let tempRoot: string | null = null;
let runtimeDatabase: RuntimeDatabase | null = null;

afterEach(async () => {
  runtimeDatabase?.close();
  runtimeDatabase = null;
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

async function createCoordinator(
  handler: RunCommandHandler,
  runtime: Partial<EffectiveConfigResponse["effectiveConfig"]["runtime"]> = {},
  handlers: Partial<Record<RunCommand["type"], RunCommandHandler>> = { continue_chapter: handler }
) {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-coordinator-"));
  const paths = createWorkspacePaths(tempRoot);
  await ensureWorkspace(paths);
  runtimeDatabase = new RuntimeDatabase(paths);
  await runtimeDatabase.initialize({ busyTimeoutMs: 1_000, backupBeforeMigration: false });
  const eventStore = new RunEventStore(runtimeDatabase);
  const config = {
    ...defaultAppConfig,
    runtime: { ...defaultAppConfig.runtime, ...runtime },
    features: { ...defaultAppConfig.features, asyncRuns: true }
  };
  const configProvider = {
    async getEffective(): Promise<EffectiveConfigResponse> {
      return {
        effectiveConfig: config,
        revision: config.revision,
        configHash: "test-config-hash",
        sources: {},
        lockedFields: [],
        restartRequiredFields: []
      };
    }
  };
  const coordinator = new RunCoordinator(configProvider, eventStore, handlers);
  return { coordinator, eventStore };
}

function command(bookId = "book-1", chapterId = "chapter-1"): RunCommand {
  return {
    schemaVersion: "run-command.v1",
    type: "continue_chapter",
    bookId,
    chapterId,
    input: {
      instruction: "继续写",
      selectedContextFileIds: [],
      sceneType: "auto",
      allowDegradedStyle: false
    }
  };
}

function initializationCommand(bookId = "book-1"): Extract<RunCommand, { type: "initialize_book" }> {
  return {
    schemaVersion: "run-command.v1",
    type: "initialize_book",
    bookId,
    input: { trigger: "manual_retry" }
  };
}

function storyPlanBatchCommand(batchNo: number, bookId = "book-scale"): Extract<RunCommand, { type: "generate_story_plan_batch" }> {
  return {
    schemaVersion: "run-command.v1",
    type: "generate_story_plan_batch",
    bookId,
    input: { batchNo }
  };
}

describe("RunCoordinator", () => {
  it("enforces global and per-book concurrency", async () => {
    let globalActive = 0;
    let maxGlobalActive = 0;
    const activeByBook = new Map<string, number>();
    let maxSameBook = 0;
    const handler: RunCommandHandler = async ({ command }) => {
      globalActive += 1;
      maxGlobalActive = Math.max(maxGlobalActive, globalActive);
      const bookActive = (activeByBook.get(command.bookId) ?? 0) + 1;
      activeByBook.set(command.bookId, bookActive);
      maxSameBook = Math.max(maxSameBook, bookActive);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      activeByBook.set(command.bookId, bookActive - 1);
      globalActive -= 1;
      return { ok: true };
    };
    const { coordinator, eventStore } = await createCoordinator(handler, {
      globalConcurrency: 2,
      perBookMutationConcurrency: 1
    });

    const runs = await Promise.all([
      coordinator.enqueue(command("book-1", "chapter-1")),
      coordinator.enqueue(command("book-1", "chapter-2")),
      coordinator.enqueue(command("book-2", "chapter-1"))
    ]);
    await coordinator.waitForIdle();

    expect(maxGlobalActive).toBe(2);
    expect(maxSameBook).toBe(1);
    expect(runs.map((run) => eventStore.getRun(run.id).status)).toEqual([
      "completed",
      "completed",
      "completed"
    ]);
  });

  it("serializes all 50 story-plan batches for the same 1000-chapter book", async () => {
    let active = 0;
    let maxActive = 0;
    const executionOrder: number[] = [];
    const handler: RunCommandHandler = async ({ command }) => {
      if (command.type !== "generate_story_plan_batch") throw new Error("unexpected command");
      active += 1;
      maxActive = Math.max(maxActive, active);
      executionOrder.push(command.input.batchNo);
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return { batchNo: command.input.batchNo };
    };
    const { coordinator, eventStore } = await createCoordinator(
      async () => ({ unused: true }),
      { globalConcurrency: 4, perBookMutationConcurrency: 1 },
      { generate_story_plan_batch: handler }
    );

    const runs = await Promise.all(Array.from({ length: 50 }, (_, index) =>
      coordinator.enqueueSystem(storyPlanBatchCommand(index + 1))
    ));
    await coordinator.waitForIdle();

    expect(maxActive).toBe(1);
    expect(executionOrder).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    expect(runs.every((run) => eventStore.getRun(run.id).status === "completed")).toBe(true);
  });

  it("aborts an active run and records cancellation", async () => {
    const handler: RunCommandHandler = ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    const { coordinator, eventStore } = await createCoordinator(handler);
    const run = await coordinator.enqueue(command());
    await waitUntil(() => eventStore.getRun(run.id).status === "running");

    coordinator.cancel(run.id);
    await coordinator.waitForIdle();

    expect(eventStore.getRun(run.id).status).toBe("cancelled");
    expect(eventStore.listEvents(run.id).map((event) => event.type)).toContain("cancel_requested");
  });

  it("pauses an active run, aborts its model call and can resume from checkpoint", async () => {
    let invocation = 0;
    const initializationHandler: RunCommandHandler = ({ signal }) => {
      invocation += 1;
      if (invocation > 1) return Promise.resolve({ resumed: true });
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    };
    const { coordinator, eventStore } = await createCoordinator(
      async () => ({ unused: true }),
      {},
      { initialize_book: initializationHandler }
    );
    const run = await coordinator.enqueueSystem(initializationCommand());
    await waitUntil(() => eventStore.getRun(run.id).status === "running");

    coordinator.pause(run.id);
    await coordinator.waitForIdle();

    const pausedRun = eventStore.getRun(run.id);
    expect(pausedRun.status).toBe("interrupted");
    const interruptEvent = eventStore.listEvents(run.id).find((event) => event.type === "run_interrupted");
    expect(interruptEvent?.payload).toMatchObject({ recoverable: true, paused: true });

    await coordinator.resumeSystem(run.id);
    await coordinator.waitForIdle();

    expect(eventStore.getRun(run.id)).toMatchObject({ status: "completed", output: { resumed: true } });
    expect(invocation).toBe(2);
  });

  it("pauses a queued run before it starts", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const handler: RunCommandHandler = async ({ command }) => {
      if (command.type === "continue_chapter" && command.chapterId === "chapter-1") await firstGate;
      return { done: true };
    };
    const { coordinator, eventStore } = await createCoordinator(handler, { globalConcurrency: 1 });
    const first = await coordinator.enqueue(command("book-1", "chapter-1"));
    const second = await coordinator.enqueue(command("book-1", "chapter-2"));
    await waitUntil(() => eventStore.getRun(first.id).status === "running");

    coordinator.pause(second.id);

    expect(eventStore.getRun(second.id).status).toBe("interrupted");
    expect(eventStore.listEvents(second.id).map((event) => event.type)).toContain("run_interrupted");
    releaseFirst();
    await coordinator.waitForIdle();
  });

  it("marks lost work interrupted and can resume the persisted command", async () => {
    const { coordinator, eventStore } = await createCoordinator(async () => ({ resumed: true }));
    const run = eventStore.createRun({ command: command(), configRevision: 1, configHash: "old-config" });

    expect(coordinator.recoverInterruptedRuns()).toBe(1);
    expect(eventStore.getRun(run.id).status).toBe("interrupted");
    await coordinator.resume(run.id);
    await coordinator.waitForIdle();

    expect(eventStore.getRun(run.id)).toMatchObject({ status: "completed", output: { resumed: true } });
  });

  it("automatically resumes interrupted required initialization workflows", async () => {
    let invocations = 0;
    const initializationHandler: RunCommandHandler = async () => {
      invocations += 1;
      return { resumed: true };
    };
    const { coordinator, eventStore } = await createCoordinator(
      async () => ({ unused: true }),
      {},
      { initialize_book: initializationHandler }
    );
    const run = eventStore.createRun({
      command: initializationCommand(),
      configRevision: 1,
      configHash: "old-config"
    });

    const recovery = await coordinator.recoverAndResumeRequiredWorkflows();
    await coordinator.waitForIdle();

    expect(recovery).toMatchObject({ interrupted: 1, resumedRunIds: [run.id], failures: [] });
    expect(invocations).toBe(1);
    expect(eventStore.getRun(run.id)).toMatchObject({ status: "completed", output: { resumed: true } });
  });

  it("allows a manually retried initialization run to resume after cancellation", async () => {
    let invocation = 0;
    const initializationHandler: RunCommandHandler = ({ signal }) => {
      invocation += 1;
      if (invocation > 1) return Promise.resolve({ resumed: true });
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    };
    const { coordinator, eventStore } = await createCoordinator(
      async () => ({ unused: true }),
      {},
      { initialize_book: initializationHandler }
    );
    const run = await coordinator.enqueueSystem(initializationCommand());
    await waitUntil(() => eventStore.getRun(run.id).status === "running");

    coordinator.cancel(run.id);
    await coordinator.waitForIdle();
    expect(eventStore.getRun(run.id).status).toBe("cancelled");

    await coordinator.resumeSystem(run.id);
    await coordinator.waitForIdle();

    expect(eventStore.getRun(run.id)).toMatchObject({ status: "completed", output: { resumed: true } });
  });

  it("records completion when cancellation arrives after an irreversible commit", async () => {
    let finishCommit!: () => void;
    const gate = new Promise<void>((resolve) => {
      finishCommit = resolve;
    });
    const initializationHandler: RunCommandHandler = async (context) => {
      context.setStage("apply_bundle");
      await gate;
      context.markCommitted?.();
      return { committed: true };
    };
    const { coordinator, eventStore } = await createCoordinator(
      async () => ({ unused: true }),
      {},
      { initialize_book: initializationHandler }
    );
    const run = await coordinator.enqueueSystem(initializationCommand());
    await waitUntil(() => eventStore.getRun(run.id).currentStage === "apply_bundle");

    coordinator.cancel(run.id);
    finishCommit();
    await coordinator.waitForIdle();

    expect(eventStore.getRun(run.id)).toMatchObject({ status: "completed", output: { committed: true } });
    expect(eventStore.listEvents(run.id).map((event) => event.type)).toEqual(expect.arrayContaining([
      "cancel_requested",
      "stage_completed",
      "run_completed"
    ]));
  });
});

async function waitUntil(predicate: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("等待条件超时");
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
}

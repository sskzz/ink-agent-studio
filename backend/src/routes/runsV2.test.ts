import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { RunCoordinator } from "../modules/agents/runCoordinator.js";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { ensureWorkspace } from "../modules/workspace/workspaceService.js";
import { createApplicationServices, type ApplicationServices } from "../runtime/applicationServices.js";

let tempRoot: string | null = null;
let services: ApplicationServices | null = null;

afterEach(async () => {
  if (services) {
    await services.runCoordinator.shutdown(100);
    services.runtimeDatabase.close();
    services = null;
  }
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

async function createTestApp(options: { replayLimit?: number } = {}) {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-runs-route-"));
  const paths = createWorkspacePaths(tempRoot);
  await ensureWorkspace(paths);
  services = createApplicationServices(paths);
  const initial = await services.configService.initialize();
  await services.configService.update({
    expectedRevision: initial.revision,
    changes: {
      features: { asyncRuns: true },
      ...(options.replayLimit ? { events: { replayLimit: options.replayLimit } } : {})
    }
  });
  const config = await services.configService.get();
  await services.runtimeDatabase.initialize({
    busyTimeoutMs: config.storage.sqliteBusyTimeoutMs,
    backupBeforeMigration: false
  });
  services.runCoordinator = new RunCoordinator(services.configService, services.runEventStore, {
    continue_chapter: async (context) => {
      context.setStage("generate");
      context.emitDelta("第一段");
      return { draft: "第一段" };
    }
  });
  return createApp(services);
}

function requestBody() {
  return {
    command: {
      schemaVersion: "run-command.v1",
      type: "continue_chapter",
      bookId: "book-1",
      chapterId: "chapter-1",
      input: {
        instruction: "继续写",
        selectedContextFileIds: [],
        sceneType: "auto",
        allowDegradedStyle: false
      }
    },
    parentRunId: null
  };
}

describe("Run V2 routes", () => {
  it("creates, executes, queries and replays a run over SSE", async () => {
    const app = await createTestApp();
    let response = await app.request("/api/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody())
    });
    expect(response.status).toBe(202);
    const accepted = (await response.json()) as { data: { runId: string; eventsUrl: string } };
    await services!.runCoordinator.waitForIdle();

    response = await app.request(`/api/v1/runs/${accepted.data.runId}`);
    const snapshot = (await response.json()) as { data: { status: string; output: unknown; lastEventSeq: number } };
    expect(snapshot.data).toMatchObject({ status: "completed", output: { draft: "第一段" } });

    response = await app.request("/api/v1/runs?limit=10&bookId=book-1");
    const list = (await response.json()) as { data: Array<{ id: string }> };
    expect(list.data.map((run) => run.id)).toContain(accepted.data.runId);

    response = await app.request(`/api/v1/runs/${accepted.data.runId}/model-attempts`);
    const attempts = (await response.json()) as { data: unknown[] };
    expect(attempts.data).toEqual([]);

    response = await app.request(accepted.data.eventsUrl);
    const replay = await response.text();
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(replay).toContain("event: run_created");
    expect(replay).toContain("event: model_delta");
    expect(replay).toContain("event: run_completed");

    response = await app.request(accepted.data.eventsUrl, {
      headers: { "Last-Event-ID": String(snapshot.data.lastEventSeq) }
    });
    await expect(response.text()).resolves.toBe("");
  });

  it("rejects a replay gap larger than the configured safety limit", async () => {
    const app = await createTestApp({ replayLimit: 2 });
    const response = await app.request("/api/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody())
    });
    const accepted = (await response.json()) as { data: { runId: string; eventsUrl: string } };
    await services!.runCoordinator.waitForIdle();

    const replayResponse = await app.request(accepted.data.eventsUrl);
    expect(replayResponse.status).toBe(409);
    const payload = (await replayResponse.json()) as { data: { details: { replayLimit: number } } };
    expect(payload.data.details.replayLimit).toBe(2);
  });
});

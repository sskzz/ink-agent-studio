// Run V2 路由测试：创建/执行/查询/SSE 事件流重放、重放缺口超过上限返回 409、
// 恢复（resume）后重放必须包含旧终态事件之后的新事件。
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { RunCoordinator, type RunCommandHandler } from "../modules/agents/runCoordinator.js";
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

async function createTestApp(options: { replayLimit?: number; handler?: RunCommandHandler; continueHandler?: RunCommandHandler } = {}) {
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
    continue_chapter: options.continueHandler ?? (async (context) => {
      context.setStage("generate");
      context.emitDelta("第一段");
      context.saveArtifact("chapter-draft.v1", { draft: "第一段" });
      return { draft: "第一段" };
    }),
    ...(options.handler ? { initialize_book: options.handler } : {})
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

    response = await app.request(`/api/v1/runs/${accepted.data.runId}/artifacts`);
    const artifacts = (await response.json()) as { data: Array<{ artifactType: string; inlineJson: unknown }> };
    expect(artifacts.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ artifactType: "chapter-draft.v1", inlineJson: { draft: "第一段" } })
    ]));

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

  it("replays events appended after a terminal event when the run is resumed", async () => {
    let invocation = 0;
    const app = await createTestApp({
      handler: async (context) => {
        invocation += 1;
        context.setStage("generate");
        context.emitDelta(`第${invocation}段`);
        // 第一次执行失败，恢复后第二次成功：同一 Run 的事件流出现"旧终态 → 新事件"
        if (invocation === 1) throw new Error("首次失败");
        return { draft: `第${invocation}段` };
      }
    });
    let response = await app.request("/api/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: {
          schemaVersion: "run-command.v1",
          type: "initialize_book",
          bookId: "book-1",
          input: { trigger: "test" }
        },
        parentRunId: null
      })
    });
    const accepted = (await response.json()) as { data: { runId: string; eventsUrl: string } };
    await services!.runCoordinator.waitForIdle();

    response = await app.request(`/api/v1/runs/${accepted.data.runId}`);
    const failed = (await response.json()) as { data: { status: string } };
    expect(failed.data.status).toBe("failed");

    // 恢复同一 Run（resumeSystem 允许 failed 状态的 initialize_book），产生旧终态之后的新事件
    await services!.runCoordinator.resumeSystem(accepted.data.runId);
    await services!.runCoordinator.waitForIdle();

    response = await app.request(accepted.data.eventsUrl);
    const replay = await response.text();
    // 回归断言：重放必须包含旧终态事件之后的新事件（旧实现会在 run_failed 处截断流）
    expect(replay.indexOf("event: run_failed")).toBeGreaterThanOrEqual(0);
    expect(replay.lastIndexOf("event: run_queued")).toBeGreaterThan(replay.indexOf("event: run_failed"));
    expect(replay).toContain("event: run_completed");
  });

  it("retries a failed run through the public route and reuses its artifact", async () => {
    let invocation = 0;
    const app = await createTestApp({
      continueHandler: async (context) => {
        invocation += 1;
        if (invocation === 1) {
          context.saveArtifact("retry-state.v1", { prepared: true });
          throw new Error("首次失败");
        }
        return { restored: context.loadArtifact("retry-state.v1")?.value };
      }
    });
    let response = await app.request("/api/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody())
    });
    const accepted = (await response.json()) as { data: { runId: string } };
    await services!.runCoordinator.waitForIdle();
    expect(services!.runEventStore.getRun(accepted.data.runId).status).toBe("failed");

    response = await app.request(`/api/v1/runs/${accepted.data.runId}/retry`, { method: "POST" });
    expect(response.status).toBe(202);
    await services!.runCoordinator.waitForIdle();
    expect(services!.runEventStore.getRun(accepted.data.runId)).toMatchObject({
      status: "completed",
      output: { restored: { prepared: true } }
    });
    expect(invocation).toBe(2);
  });
});

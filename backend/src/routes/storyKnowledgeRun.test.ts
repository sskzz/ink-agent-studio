import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { RunCoordinator } from "../modules/agents/runCoordinator.js";
import { createBook } from "../modules/books/bookService.js";
import { createInitialStoryPlan, writeStoryPlan } from "../modules/books/storyKnowledgeRepository.js";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { ensureWorkspace } from "../modules/workspace/workspaceService.js";
import { createApplicationServices, type ApplicationServices } from "../runtime/applicationServices.js";

let root: string | null = null;
let services: ApplicationServices | null = null;

afterEach(async () => {
  await services?.runCoordinator.shutdown(100);
  services?.runtimeDatabase.close();
  services = null;
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

describe("story plan batch Run route", () => {
  it("以 202 入队并复用同批次活动 Run", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "ink-agent-story-route-"));
    const paths = createWorkspacePaths(root);
    await ensureWorkspace(paths);
    services = createApplicationServices(paths);
    const config = await services.configService.initialize();
    await services.runtimeDatabase.initialize({
      busyTimeoutMs: config.storage.sqliteBusyTimeoutMs,
      backupBeforeMigration: false
    });
    const book = await createBook(paths, { title: "异步章纲测试" });
    await writeStoryPlan(paths, book.id, createInitialStoryPlan(book.id, {
      mainLine: "主角寻找真相。",
      estimatedChapters: 50,
      volumes: [{
        title: "第一卷", goal: "找到入口", conflict: "敌人阻拦", turningPoint: "线索反转",
        climax: "进入遗迹", resolution: "获得新目标", characterChanges: []
      }],
      terms: []
    }));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    services.runCoordinator = new RunCoordinator(services.configService, services.runEventStore, {
      generate_story_plan_batch: async (context) => {
        context.setStage("generate_batch_attempt_1");
        context.saveArtifact("story-plan.batch-1.approved.v1", { ok: true });
        await gate;
        return { batchNo: 1 };
      }
    });
    const app = createApp(services);

    const first = await app.request(`/api/v1/books/${book.id}/story-plan/batches/1/generate`, { method: "POST" });
    const firstPayload = (await first.json()) as { data: { runId: string; reused: boolean } };
    const second = await app.request(`/api/v1/books/${book.id}/story-plan/batches/1/generate`, { method: "POST" });
    const secondPayload = (await second.json()) as { data: { runId: string; reused: boolean } };

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(secondPayload.data).toMatchObject({ runId: firstPayload.data.runId, reused: true });
    release();
    await services.runCoordinator.waitForIdle();
    expect(services.runEventStore.getRun(firstPayload.data.runId).status).toBe("completed");
    expect(services.runEventStore.listArtifacts(firstPayload.data.runId)).toHaveLength(1);
  });
});

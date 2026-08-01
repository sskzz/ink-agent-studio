import { mkdtemp, readdir, rm } from "node:fs/promises";
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

describe("book initialization routes", () => {
  it("automatically starts one system run after creation and reuses it for manual retry", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-books-route-"));
    const paths = createWorkspacePaths(tempRoot);
    await ensureWorkspace(paths);
    services = createApplicationServices(paths);
    const config = await services.configService.initialize();
    await services.runtimeDatabase.initialize({
      busyTimeoutMs: config.storage.sqliteBusyTimeoutMs,
      backupBeforeMigration: false
    });

    let releaseHandler!: () => void;
    const handlerGate = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    services.runCoordinator = new RunCoordinator(services.configService, services.runEventStore, {
      initialize_book: async (context) => {
        context.setStage("foundation");
        await handlerGate;
        return { initialized: true };
      }
    });
    const app = createApp(services);

    let response = await app.request("/api/v1/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "自动初始化测试" })
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as {
      data: { id: string; initialization: { runId: string; status: string } };
    };
    expect(created.data.initialization.runId).toBeTruthy();
    await waitUntil(() => services!.runEventStore.getRun(created.data.initialization.runId).status === "running");

    response = await app.request(`/api/v1/books/${created.data.id}`);
    const detail = (await response.json()) as {
      data: { initialization: { runId: string; status: string; stage: string } };
    };
    expect(detail.data.initialization).toMatchObject({
      runId: created.data.initialization.runId,
      status: "running",
      stage: "foundation"
    });

    response = await app.request(`/api/v1/books/${created.data.id}/initialize`, { method: "POST" });
    expect(response.status).toBe(202);
    const retry = (await response.json()) as { data: { runId: string; reused: boolean } };
    expect(retry.data).toEqual({ runId: created.data.initialization.runId, reused: true, status: "running", stage: "foundation", error: null });
    expect(services.runEventStore.listRuns({ bookId: created.data.id, limit: 20 })).toHaveLength(1);

    releaseHandler();
    await services.runCoordinator.waitForIdle();
    expect(services.runEventStore.getRun(created.data.initialization.runId).status).toBe("completed");
  });

  it("rolls back the newly created book when initialization cannot enter the queue", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-books-route-rollback-"));
    const paths = createWorkspacePaths(tempRoot);
    await ensureWorkspace(paths);
    services = createApplicationServices(paths);
    const config = await services.configService.initialize();
    await services.runtimeDatabase.initialize({
      busyTimeoutMs: config.storage.sqliteBusyTimeoutMs,
      backupBeforeMigration: false
    });
    services.runCoordinator.enqueueSystem = async () => {
      throw new Error("测试队列拒绝");
    };
    const app = createApp(services);

    const response = await app.request("/api/v1/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "不应残留的作品" })
    });

    expect(response.status).toBe(500);
    const booksResponse = await app.request("/api/v1/books");
    const books = (await booksResponse.json()) as { data: unknown[] };
    expect(books.data).toEqual([]);
    expect(await readdir(paths.booksDir)).toEqual([]);
  });
});

async function waitUntil(predicate: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("等待条件超时");
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
}

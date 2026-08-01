import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { ensureWorkspace } from "../modules/workspace/workspaceService.js";
import { createApplicationServices, type ApplicationServices } from "../runtime/applicationServices.js";

let tempRoot: string | null = null;
let services: ApplicationServices | null = null;

afterEach(async () => {
  services?.runtimeDatabase.close();
  services = null;
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

describe("Session routes", () => {
  it("creates, lists, searches and archives a session", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-session-routes-"));
    const paths = createWorkspacePaths(tempRoot);
    await ensureWorkspace(paths);
    services = createApplicationServices(paths);
    const config = await services.configService.initialize();
    await services.runtimeDatabase.initialize({
      busyTimeoutMs: config.storage.sqliteBusyTimeoutMs,
      backupBeforeMigration: false
    });
    const app = createApp(services);

    let response = await app.request("/api/v1/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookId: "book-route", title: "路由会话", parentSessionId: null })
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { data: { id: string } };

    response = await app.request(`/api/v1/sessions/${created.data.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "user", content: "检查潮汐纹钥匙", metadata: {} })
    });
    expect(response.status).toBe(201);

    response = await app.request("/api/v1/sessions/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "潮汐纹", bookId: "book-route", limit: 10 })
    });
    const search = (await response.json()) as { data: Array<{ snippet: string }> };
    expect(search.data[0].snippet).toContain("潮汐纹");

    response = await app.request(`/api/v1/sessions/${created.data.id}/archive`, { method: "POST" });
    expect(response.status).toBe(200);
    response = await app.request("/api/v1/sessions?bookId=book-route&limit=10");
    const list = (await response.json()) as { data: Array<{ status: string }> };
    expect(list.data[0].status).toBe("archived");
  });
});

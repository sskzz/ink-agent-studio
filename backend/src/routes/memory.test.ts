import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { ensureWorkspace } from "../modules/workspace/workspaceService.js";
import { createApplicationServices, type ApplicationServices } from "../runtime/applicationServices.js";

let root: string | null = null;
let services: ApplicationServices | null = null;

afterEach(async () => {
  services?.runtimeDatabase.close();
  services = null;
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

describe("memory routes", () => {
  it("provides the complete proposal approval preview and archive workflow", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "ink-agent-memory-routes-"));
    const paths = createWorkspacePaths(root);
    await ensureWorkspace(paths);
    services = createApplicationServices(paths);
    const config = await services.configService.initialize();
    await services.runtimeDatabase.initialize({ busyTimeoutMs: config.storage.sqliteBusyTimeoutMs, backupBeforeMigration: false });
    const app = createApp(services);

    let response = await app.request("/api/v1/memory/preferences/proposals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        category: "writing",
        key: "narrative_pacing",
        value: "叙事节奏保持紧凑。",
        reason: "长期写作偏好。",
        priority: 75,
        sourceSessionId: null,
        sourceMessageId: null
      })
    });
    expect(response.status).toBe(201);
    const proposed = await response.json() as { data: { id: string; status: string } };
    expect(proposed.data.status).toBe("proposed");

    response = await app.request(`/api/v1/memory/preferences/${proposed.data.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: true })
    });
    expect(response.status).toBe(200);
    response = await app.request("/api/v1/memory/preferences?status=active&limit=10");
    expect((await response.json() as { data: unknown[] }).data).toHaveLength(1);
    response = await app.request("/api/v1/memory/prompt-preview");
    expect((await response.json() as { data: { prompt: string } }).data.prompt).toContain("叙事节奏保持紧凑");

    response = await app.request(`/api/v1/memory/preferences/${proposed.data.id}/archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: true })
    });
    expect(response.status).toBe(200);
    expect((await response.json() as { data: { status: string } }).data.status).toBe("archived");
  });

  it("rejects malformed limits, missing approval and story facts", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "ink-agent-memory-routes-"));
    const paths = createWorkspacePaths(root);
    await ensureWorkspace(paths);
    services = createApplicationServices(paths);
    const config = await services.configService.initialize();
    await services.runtimeDatabase.initialize({ busyTimeoutMs: config.storage.sqliteBusyTimeoutMs, backupBeforeMigration: false });
    const app = createApp(services);

    expect((await app.request("/api/v1/memory/preferences?limit=0")).status).toBe(400);
    let response = await app.request("/api/v1/memory/preferences/proposals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        category: "writing",
        key: "paragraph_length",
        value: "主角叫林舟。",
        reason: "保存设定",
        priority: 50,
        sourceSessionId: null,
        sourceMessageId: null
      })
    });
    expect(response.status).toBe(400);

    response = await app.request("/api/v1/memory/preferences/proposals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        category: "writing",
        key: "paragraph_length",
        value: "正文使用短段落。",
        reason: "长期偏好",
        priority: 50,
        sourceSessionId: null,
        sourceMessageId: null
      })
    });
    const proposed = await response.json() as { data: { id: string } };
    response = await app.request(`/api/v1/memory/preferences/${proposed.data.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    expect(response.status).toBe(400);
  });
});

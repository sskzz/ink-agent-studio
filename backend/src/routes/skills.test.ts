// 技能路由测试：内置技能列表与预算化选择预览。
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

describe("skill routes", () => {
  it("lists builtins and previews a budgeted selection", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "ink-agent-skill-routes-"));
    const paths = createWorkspacePaths(root);
    await ensureWorkspace(paths);
    services = createApplicationServices(paths);
    const app = createApp(services);
    const list = await app.request("/api/v1/skills");
    expect(list.status).toBe(200);
    const listPayload = await list.json() as { data: Array<{ id: string }> };
    expect(listPayload.data.map((item) => item.id)).toContain("continuation-writing");

    const current = await services.configService.initialize();
    await services.configService.update({
      expectedRevision: current.revision,
      changes: { features: { skills: true } }
    });
    const preview = await app.request("/api/v1/skills/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "writing", instruction: "继续续写正文", context: "", requestedSkillIds: [] })
    });
    expect(preview.status).toBe(200);
    const previewPayload = await preview.json() as { data: { prompt: string; trace: { selected: Array<{ id: string }> } } };
    expect(previewPayload.data.prompt).toContain("章节续写");
    expect(previewPayload.data.trace.selected.map((item) => item.id)).toContain("continuation-writing");
  });
});

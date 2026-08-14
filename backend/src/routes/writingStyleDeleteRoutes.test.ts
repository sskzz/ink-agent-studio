// 写作风格删除路由：永久清理独立风格资产，并阻止删除仍被作品引用的风格。
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createWritingStylePaths } from "../modules/styles/writingStylePaths.js";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { pathExists } from "../utils/fileStore.js";

interface ApiPayload<T> { data: T; }
let tempRoot: string | null = null;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-style-delete-"));
  process.env.INK_AGENT_DATA_DIR = tempRoot;
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
  delete process.env.INK_AGENT_DATA_DIR;
});

describe("writing style deletion", () => {
  it("deletes an unreferenced style and its complete asset directory", async () => {
    const app = createApp();
    const createResponse = await app.request("/api/v1/writing-styles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "待删除风格",
        summary: "删除测试",
        parameters: {},
        seedSample: {
          fileName: "seed.txt",
          content: "她停在窗前，没有解释。风从旧街尽头吹来。".repeat(80)
        }
      })
    });
    const styleId = ((await createResponse.json()) as ApiPayload<{ id: string }>).data.id;
    const styleDir = createWritingStylePaths(createWorkspacePaths(), styleId).styleDir;
    expect(await pathExists(styleDir)).toBe(true);

    const deleteResponse = await app.request(`/api/v1/writing-styles/${styleId}`, { method: "DELETE" });
    expect(deleteResponse.status).toBe(200);
    expect(((await deleteResponse.json()) as ApiPayload<{ id: string; deleted: boolean }>).data)
      .toEqual({ id: styleId, deleted: true });
    expect(await pathExists(styleDir)).toBe(false);

    const listResponse = await app.request("/api/v1/writing-styles");
    const styles = (await listResponse.json()) as ApiPayload<Array<{ id: string }>>;
    expect(styles.data.some((style) => style.id === styleId)).toBe(false);
    expect((await app.request(`/api/v1/writing-styles/${styleId}`)).status).toBe(404);
  });

  it("returns 409 when a book still references the style", async () => {
    const app = createApp();
    const createResponse = await app.request("/api/v1/writing-styles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "作品引用风格", summary: "删除保护测试", parameters: {} })
    });
    const styleId = ((await createResponse.json()) as ApiPayload<{ id: string }>).data.id;
    const bookResponse = await app.request("/api/v1/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "引用风格的作品", writingStyleId: styleId })
    });
    expect(bookResponse.status).toBe(201);

    const deleteResponse = await app.request(`/api/v1/writing-styles/${styleId}`, { method: "DELETE" });
    expect(deleteResponse.status).toBe(409);
    expect(((await deleteResponse.json()) as { message: string }).message).toContain("仍被作品使用");
    expect((await app.request(`/api/v1/writing-styles/${styleId}`)).status).toBe(200);
  });
});

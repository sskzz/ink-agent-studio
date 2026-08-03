// 写作风格样本与版本路由测试：聚合样本生成不可变版本、旧版 v3 惰性迁移、只读不落盘、并发写串行化。
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { ensureWorkspace } from "../modules/workspace/workspaceService.js";
import { createWritingStylePaths } from "../modules/styles/writingStylePaths.js";

interface ApiPayload<T> { data: T; }
let tempRoot: string | null = null;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-style-version-"));
  process.env.INK_AGENT_DATA_DIR = tempRoot;
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
  delete process.env.INK_AGENT_DATA_DIR;
});

describe("writing style sample and version routes", () => {
  it("aggregates multiple samples into an immutable version and pins it to a book", async () => {
    const app = createApp();
    let response = await app.request("/api/v1/writing-styles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "多样本风格", summary: "短段、克制。", parameters: {} })
    });
    const styleId = ((await response.json()) as ApiPayload<{ id: string }>).data.id;
    for (let index = 0; index < 3; index++) {
      const paragraphs = Array.from({ length: 60 }, (_, line) => `她在第${line}次脚步响起时停住。风从门缝里进来，她没有解释，只把钥匙放下。`).join("\n");
      response = await app.request(`/api/v1/writing-styles/${styleId}/samples`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: `sample-${index}.txt`, content: `${paragraphs}\n${"尾声".repeat(index + 1)}` })
      });
      expect(response.status).toBe(201);
    }

    response = await app.request(`/api/v1/writing-styles/${styleId}/rebuild`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const version = (await response.json()) as ApiPayload<{ id: string; sampleIds: string[]; styleHash: string }>;
    expect(response.status).toBe(200);
    expect(version.data.sampleIds).toHaveLength(3);
    expect(version.data.styleHash).toHaveLength(64);

    const concurrentRebuilds = await Promise.all([
      app.request(`/api/v1/writing-styles/${styleId}/rebuild`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      app.request(`/api/v1/writing-styles/${styleId}/rebuild`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    ]);
    const concurrentVersions = await Promise.all(concurrentRebuilds.map((item) => item.json() as Promise<ApiPayload<{ id: string }>>));
    expect(concurrentVersions.map((item) => item.data.id)).toEqual([version.data.id, version.data.id]);

    response = await app.request(`/api/v1/writing-styles/${styleId}/versions`);
    const versions = (await response.json()) as ApiPayload<Array<{ id: string }>>;
    expect(versions.data[0]?.id).toBe(version.data.id);

    response = await app.request("/api/v1/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "版本固定测试", writingStyleId: styleId })
    });
    const book = (await response.json()) as ApiPayload<{ writingStyleVersionId: string }>;
    expect(book.data.writingStyleVersionId).toBe(version.data.id);
  });

  it("lazily migrates a legacy v3 style into an immutable compatibility version", async () => {
    const app = createApp();
    let response = await app.request("/api/v1/writing-styles/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "旧版风格", sampleFileName: "legacy.txt", content: "她停在门边，没有解释。\n".repeat(50) })
    });
    const preview = (await response.json()) as ApiPayload<{
      name: string;
      summary: string;
      parameters: Record<string, unknown>;
      analysis: Record<string, unknown>;
      featureProfile: Record<string, unknown>;
    }>;
    response = await app.request("/api/v1/writing-styles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...preview.data, sampleFileName: "legacy.txt" })
    });
    const styleId = ((await response.json()) as ApiPayload<{ id: string }>).data.id;
    await ensureWorkspace(createWorkspacePaths());
    response = await app.request("/api/v1/writing-styles");
    const styles = (await response.json()) as ApiPayload<Array<{ id: string; latestVersionId?: string }>>;
    const migrated = styles.data.find((style) => style.id === styleId);
    expect(migrated?.latestVersionId).toMatch(/^legacy-/);
    response = await app.request(`/api/v1/writing-styles/${styleId}/versions`);
    const versions = (await response.json()) as ApiPayload<Array<{ id: string; status: string }>>;
    expect(versions.data[0]).toMatchObject({ id: migrated?.latestVersionId, status: "degraded" });
  });

  it("keeps list and detail reads free of filesystem writes", async () => {
    const app = createApp();
    const response = await app.request("/api/v1/writing-styles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "只读测试", summary: "测试", parameters: {} })
    });
    const styleId = ((await response.json()) as ApiPayload<{ id: string }>).data.id;
    const detailPath = createWritingStylePaths(createWorkspacePaths(), styleId).styleFile;
    const before = (await stat(detailPath)).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 25));
    await app.request("/api/v1/writing-styles");
    await app.request(`/api/v1/writing-styles/${styleId}`);
    expect((await stat(detailPath)).mtimeMs).toBe(before);
  });

  it("serializes concurrent sample writes without losing index entries", async () => {
    const app = createApp();
    const response = await app.request("/api/v1/writing-styles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "并发测试", summary: "测试", parameters: {} })
    });
    const styleId = ((await response.json()) as ApiPayload<{ id: string }>).data.id;
    const results = await Promise.all(Array.from({ length: 5 }, (_, index) =>
      app.request(`/api/v1/writing-styles/${styleId}/samples`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: `${index}.txt`, content: `样本${index}。${"她停在门边，没有解释。".repeat(60)}` })
      })
    ));
    expect(results.every((item) => item.status === 201)).toBe(true);
    const listed = await app.request(`/api/v1/writing-styles/${styleId}/samples`);
    const samples = (await listed.json()) as ApiPayload<Array<{ id: string }>>;
    expect(samples.data).toHaveLength(5);
  });
});

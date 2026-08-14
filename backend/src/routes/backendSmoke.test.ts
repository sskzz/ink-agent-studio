// 后端路由冒烟测试：覆盖 CORS、作品/文件/实体/章节、AI 初始化、写作风格、模型分析等主链路。
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createBookPaths } from "../modules/books/bookPaths.js";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { pathExists } from "../utils/fileStore.js";

interface ApiPayload<T> {
  data: T;
}

let tempRoot: string | null = null;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-smoke-"));
  process.env.INK_AGENT_DATA_DIR = tempRoot;
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }

  delete process.env.INK_AGENT_DATA_DIR;
});

describe("backend routes smoke", () => {
  it("覆盖文件、实体、章节、AI 初始化入口和写作风格接口", async () => {
    const app = createApp();
    let response = await app.request("/api/v1/model-configs", {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:5175",
        "Access-Control-Request-Method": "GET"
      }
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5175");

    response = await app.request("/api/v1/books");
    const booksPayload = (await response.json()) as ApiPayload<Array<{ id: string }>>;
    expect(booksPayload.data).toHaveLength(0);

    response = await app.request("/api/v1/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "World Upload Test",
        worldFileName: "world.md",
        worldFileContent: "# 自定义世界观\n\n这里是用户上传的世界观正文。"
      })
    });
    const createdBookPayload = (await response.json()) as ApiPayload<{ id: string }>;
    const createdBookId = createdBookPayload.data.id;
    const bookId = createdBookId;
    expect(response.status).toBe(201);

    response = await app.request(`/api/v1/books/${createdBookId}/files/world`);
    const worldPayload = (await response.json()) as ApiPayload<{ content: string }>;
    expect(worldPayload.data.content).toContain("用户上传的世界观正文");

    response = await app.request(`/api/v1/books/${bookId}/files/brief`);
    expect(response.status).toBe(200);

    response = await app.request(`/api/v1/books/${bookId}/entities`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entityType: "character",
        name: "Test Role",
        role: "main",
        description: "smoke test"
      })
    });
    expect(response.status).toBe(201);

    response = await app.request(`/api/v1/books/${bookId}/chapters`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Test Chapter",
        outline: "主角沿既有线索继续推进，并在段末形成新的悬念。",
        content: "# Test Chapter\n\nFirst paragraph."
      })
    });
    const chapterPayload = (await response.json()) as ApiPayload<{ id: string }>;
    const chapterId = chapterPayload.data.id as string;
    expect(response.status).toBe(201);

    response = await app.request(`/api/v1/books/${bookId}`);
    const bookDetailPayload = (await response.json()) as ApiPayload<{
      progress: { currentChapterId: string | null; currentChapterTitle: string | null };
    }>;
    expect(response.status).toBe(200);
    expect(bookDetailPayload.data.progress.currentChapterId).toBe(chapterId);
    expect(bookDetailPayload.data.progress.currentChapterTitle).toBe("1. Test Chapter");

    response = await app.request(`/api/v1/books/${bookId}/chapters/${chapterId}/continue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction: "Continue one paragraph." })
    });
    expect(response.status).toBe(400);

    response = await app.request(`/api/v1/books/${bookId}/initialize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    expect(response.status).toBe(503);

    response = await app.request("/api/v1/writing-styles");
    const stylesBeforeAnalyze = (await response.json()) as ApiPayload<Array<{ id: string }>>;

    response = await app.request("/api/v1/writing-styles/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Test Style",
        sampleFileName: "sample.md",
        content: "First paragraph. Dialogue."
      })
    });
    expect(response.status).toBe(200);

    response = await app.request("/api/v1/writing-styles");
    const stylesAfterAnalyze = (await response.json()) as ApiPayload<Array<{ id: string }>>;
    expect(stylesAfterAnalyze.data).toHaveLength(stylesBeforeAnalyze.data.length);

    response = await app.request("/api/v1/model-analysis");
    const modelAnalysisPayload = (await response.json()) as ApiPayload<{
      score: number;
      summary: { totalConfigs: number };
    }>;
    expect(response.status).toBe(200);
    expect(modelAnalysisPayload.data.score).toBeGreaterThanOrEqual(0);
    expect(modelAnalysisPayload.data.summary.totalConfigs).toBe(0);

    response = await app.request("/api/v1/model-routes/planning", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelConfigId: null })
    });
    const planningRoutePayload = (await response.json()) as ApiPayload<{ planningModelId: string | null }>;
    expect(response.status).toBe(200);
    expect(planningRoutePayload.data.planningModelId).toBeNull();

    const bookDir = createBookPaths(createWorkspacePaths(), bookId).bookDir;
    expect(await pathExists(bookDir)).toBe(true);

    response = await app.request(`/api/v1/books/${bookId}`, { method: "DELETE" });
    expect(response.status).toBe(200);
    expect(await pathExists(bookDir)).toBe(false);

    response = await app.request(`/api/v1/books/${bookId}`);
    expect(response.status).toBe(404);

    response = await app.request("/api/v1/books");
    const booksAfterDelete = (await response.json()) as ApiPayload<Array<{ id: string }>>;
    expect(booksAfterDelete.data).toHaveLength(0);
  });
});

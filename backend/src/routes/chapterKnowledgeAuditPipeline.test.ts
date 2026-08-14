import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { createBaselineRuntimeState, writeRuntimeState } from "../modules/books/runtimeStateRepository.js";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";

interface ApiPayload<T> { data: T; }

let tempRoot: string | null = null;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-knowledge-pipeline-"));
  process.env.INK_AGENT_DATA_DIR = tempRoot;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
  delete process.env.INK_AGENT_DATA_DIR;
});

describe("chapter knowledge audit pipeline", () => {
  it("对漏回收的强制伏笔执行一次定向修订并复审通过", async () => {
    const app = createApp();
    let response = await app.request("/api/v1/model-configs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "知识审核测试模型",
        provider: "openai-compatible",
        baseUrl: "https://models.example/v1",
        apiKey: "test-key",
        apiModel: "novel-model",
        purpose: "writing"
      })
    });
    const modelId = ((await response.json()) as ApiPayload<{ id: string }>).data.id;
    for (const route of ["writing", "review"]) {
      response = await app.request(`/api/v1/model-routes/${route}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelConfigId: modelId })
      });
      expect(response.status).toBe(200);
    }

    response = await app.request("/api/v1/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "知识审核测试" })
    });
    const bookId = ((await response.json()) as ApiPayload<{ id: string }>).data.id;
    const paths = createWorkspacePaths(tempRoot!);
    await writeRuntimeState(paths, bookId, createBaselineRuntimeState({
      storyStart: "故事开始",
      publicFacts: [],
      secrets: [],
      nextGoals: [],
      characterStates: [],
      factionStates: [],
      itemStates: [],
      foreshadowing: [{
        id: "hook-sister",
        content: "姐姐失踪与王城有关",
        relatedEntityIds: [],
        placement: "第 2 章",
        resolution: "第 10 章揭示姐姐被王城囚禁",
        targetChapterRange: { start: 9, end: 10 },
        status: "advancing",
        missedCount: 2,
        lastAdvancedChapter: 8
      }]
    }));
    response = await app.request(`/api/v1/books/${bookId}/chapters`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chapterNo: 12, title: "第十二章", outline: "主角进入地牢，回收姐姐去向的伏笔。" })
    });
    const chapterId = ((await response.json()) as ApiPayload<{ id: string }>).data.id;

    const prompts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      const systemPrompt = body.messages[0]?.content ?? "";
      prompts.push(systemPrompt);
      const content = systemPrompt.includes("章节规划师")
        ? JSON.stringify({ schemaVersion: "chapter-intent.v1", mustKeep: ["回收姐姐去向"], mustAvoid: ["遗漏伏笔"] })
        : systemPrompt.includes("知识一致性修订模型")
          ? "林夕在地牢中发现姐姐被王城囚禁的证据。"
          : systemPrompt.includes("写作风格审稿器")
            ? JSON.stringify({ schemaVersion: "semantic-style-review.v1", passed: true, score: 95, violations: [], warnings: [] })
            : "林夕独自走进地牢。";
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }));

    response = await app.request(`/api/v1/books/${bookId}/chapters/${chapterId}/continue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ generationMode: "generate", allowDegradedStyle: true })
    });
    const result = (await response.json()) as ApiPayload<{
      outputJson: {
        draft: string;
        knowledgeAudit: { initial: { passed: boolean }; final: { passed: boolean }; revisionCount: number };
      };
    }>;

    expect(response.status).toBe(200);
    expect(result.data.outputJson.draft).toContain("姐姐被王城囚禁");
    expect(result.data.outputJson.knowledgeAudit).toMatchObject({
      initial: { passed: false },
      final: { passed: true },
      revisionCount: 1
    });
    expect(prompts.some((prompt) => prompt.includes("知识一致性修订模型"))).toBe(true);
  });
});

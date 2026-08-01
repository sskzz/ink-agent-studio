import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";

interface ApiPayload<T> { data: T; }
let tempRoot: string | null = null;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-style-chapter-"));
  process.env.INK_AGENT_DATA_DIR = tempRoot;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
  delete process.env.INK_AGENT_DATA_DIR;
});

describe("chapter writing style constraints", () => {
  it("injects the selected style into writing, review and polish model prompts", async () => {
    const app = createApp();
    let response = await app.request("/api/v1/settings");
    const settings = (await response.json()) as ApiPayload<{ revision: number }>;
    response = await app.request("/api/v1/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: settings.data.revision,
        changes: { features: { skills: true } }
      })
    });
    expect(response.status).toBe(200);

    response = await app.request("/api/v1/writing-styles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "冷静贴身",
        summary: "保持第三人称贴身视角，使用短段，情绪通过动作呈现。",
        parameters: { pacing: "长短句交替", dialogue: "对白保留潜台词" }
      })
    });
    const styleId = ((await response.json()) as ApiPayload<{ id: string }>).data.id;

    response = await app.request("/api/v1/model-configs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Shared writing model",
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
      body: JSON.stringify({ title: "风格约束测试", writingStyleId: styleId, chapterWords: 1200 })
    });
    const bookId = ((await response.json()) as ApiPayload<{ id: string }>).data.id;
    response = await app.request(`/api/v1/books/${bookId}/chapters`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "第一章", content: "# 第一章\n\n门外传来脚步声。" })
    });
    const chapterId = ((await response.json()) as ApiPayload<{ id: string }>).data.id;

    const prompts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      const systemPrompt = body.messages[0]?.content ?? "";
      prompts.push(body.messages.map((message) => message.content).join("\n"));
      const content = systemPrompt.includes("写作风格审稿器")
        ? JSON.stringify({ schemaVersion: "semantic-style-review.v1", passed: true, score: 92, violations: [], warnings: [] })
        : systemPrompt.includes("修订模型")
          ? "门外脚步停了。她没有回头。"
          : "她按住门把，等脚步停在门外。";
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }));

    response = await app.request(`/api/v1/books/${bookId}/chapters/${chapterId}/continue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction: "续写一个悬念段落", allowDegradedStyle: true })
    });
    const continued = (await response.json()) as ApiPayload<{
      outputJson: { draft: string; writingStyle: { styleId: string } };
    }>;
    expect(response.status).toBe(200);
    expect(continued.data.outputJson.draft).toContain("按住门把");
    expect(continued.data.outputJson.writingStyle.styleId).toBe(styleId);

    response = await app.request(`/api/v1/books/${bookId}/chapters/${chapterId}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowDegradedStyle: true })
    });
    expect(response.status).toBe(200);

    response = await app.request(`/api/v1/books/${bookId}/chapters/${chapterId}/polish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowDegradedStyle: true })
    });
    expect(response.status).toBe(200);
    expect(prompts).toHaveLength(4);
    expect(prompts.every((prompt) => prompt.includes("第三人称贴身视角"))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes("【技能：章节续写】"))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes("【技能：连续性审查】"))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes("【技能：去 AI 味】"))).toBe(true);
  });

  it("rejects a stale writingStyleId instead of silently ignoring it", async () => {
    const app = createApp();
    let response = await app.request("/api/v1/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "无效风格测试", writingStyleId: "missing-style" })
    });
    const bookId = ((await response.json()) as ApiPayload<{ id: string }>).data.id;
    response = await app.request(`/api/v1/books/${bookId}/chapters`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "第一章", content: "正文" })
    });
    const chapterId = ((await response.json()) as ApiPayload<{ id: string }>).data.id;

    response = await app.request(`/api/v1/books/${bookId}/chapters/${chapterId}/continue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    expect(response.status).toBe(404);
  });

  it("revises a materially noncompliant draft once and records both checks", async () => {
    const app = createApp();
    let response = await app.request("/api/v1/writing-styles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "短句节奏",
        summary: "使用短句和短段推进。",
        parameters: {},
        featureProfile: {
          schemaVersion: "style-features.v1",
          sourceContentLength: 1200,
          metrics: { averageSentenceLength: 8, shortSentenceRatio: 0.95, longSentenceRatio: 0 }
        }
      })
    });
    const styleId = ((await response.json()) as ApiPayload<{ id: string }>).data.id;
    response = await app.request("/api/v1/model-configs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Writing model",
        provider: "openai-compatible",
        baseUrl: "https://models.example/v1",
        apiKey: "test-key",
        apiModel: "writer",
        purpose: "writing"
      })
    });
    const modelId = ((await response.json()) as ApiPayload<{ id: string }>).data.id;
    await app.request("/api/v1/model-routes/writing", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelConfigId: modelId })
    });
    response = await app.request("/api/v1/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "自动修订测试", writingStyleId: styleId })
    });
    const bookId = ((await response.json()) as ApiPayload<{ id: string }>).data.id;
    response = await app.request(`/api/v1/books/${bookId}/chapters`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "第一章", content: "开场。" })
    });
    const chapterId = ((await response.json()) as ApiPayload<{ id: string }>).data.id;

    let modelCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      modelCalls += 1;
      const content = modelCalls === 1
        ? `${"这是一个持续延伸且没有任何停顿的超长句子".repeat(12)}。`
        : Array.from({ length: 30 }, () => "门响了。她没动。").join("\n");
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }));

    response = await app.request(`/api/v1/books/${bookId}/chapters/${chapterId}/continue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowDegradedStyle: true })
    });
    const payload = (await response.json()) as ApiPayload<{
      outputJson: {
        revisionCount: number;
        styleCompliance: { initial: { passed: boolean }; final: { score: number } };
      };
    }>;

    expect(response.status).toBe(200);
    expect(modelCalls).toBe(2);
    expect(payload.data.outputJson.revisionCount).toBe(1);
    expect(payload.data.outputJson.styleCompliance.initial.passed).toBe(false);
    expect(payload.data.outputJson.styleCompliance.final.score).toBeGreaterThan(0);
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";

interface ApiPayload<T> { data: T; }
let tempRoot: string | null = null;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-v2-e2e-"));
  process.env.INK_AGENT_DATA_DIR = tempRoot;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
  delete process.env.INK_AGENT_DATA_DIR;
});

describe("writing style v2 end-to-end", () => {
  it("uses one pinned version and compiled style hash across generation, review and polish", async () => {
    const app = createApp();
    let response = await app.request("/api/v1/writing-styles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "稳定短句", summary: "短句、短段、贴身观察。", parameters: {} })
    });
    const styleId = ((await response.json()) as ApiPayload<{ id: string }>).data.id;
    for (let index = 0; index < 3; index++) {
      const content = Array.from({ length: 70 }, (_, line) => `她停住。第${line}次脚步响起。风从门缝里钻进来。她没有解释。`).join("\n");
      await app.request(`/api/v1/writing-styles/${styleId}/samples`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: `${index}.txt`, content: `${content}\n${"余音".repeat(index + 1)}` })
      });
    }
    response = await app.request(`/api/v1/writing-styles/${styleId}/rebuild`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const versionId = ((await response.json()) as ApiPayload<{ id: string }>).data.id;

    response = await app.request("/api/v1/model-configs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "共享模型", provider: "openai-compatible", baseUrl: "https://models.example/v1", apiKey: "key", apiModel: "novel", purpose: "writing" })
    });
    const modelId = ((await response.json()) as ApiPayload<{ id: string }>).data.id;
    for (const route of ["writing", "review"]) {
      await app.request(`/api/v1/model-routes/${route}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ modelConfigId: modelId }) });
    }

    response = await app.request("/api/v1/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "端到端测试", writingStyleId: styleId, worldFileContent: "SECRET_WORLD_FACT_不可重复保存" })
    });
    const book = (await response.json()) as ApiPayload<{ id: string; writingStyleVersionId: string }>;
    expect(book.data.writingStyleVersionId).toBe(versionId);
    response = await app.request(`/api/v1/books/${book.data.id}/chapters`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "第一章", outline: "追逐后在门边制造悬念", content: "# 第一章\n\n脚步越来越近。" })
    });
    const chapterId = ((await response.json()) as ApiPayload<{ id: string }>).data.id;

    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      const system = body.messages[0]?.content ?? "";
      const content = system.includes("修复给定内容")
        ? JSON.stringify({ schemaVersion: "semantic-style-review.v1", passed: true, score: 92, violations: [], warnings: [] })
        : system.includes("写作风格审稿器")
          ? "invalid semantic json"
        : system.includes("正文修订模型")
          ? "门响了。她没动。脚步停在外面。"
          : "她冲到门边。门响了。她没动。";
      return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }));

    response = await app.request(`/api/v1/books/${book.data.id}/chapters/${chapterId}/continue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sceneType: "action" })
    });
    const generated = (await response.json()) as ApiPayload<{
      outputJson: { writingStyle: { styleVersionId: string; constraintHash: string } };
      styleTraceJson: { stageTimings: Record<string, number> };
      tokenUsageJson: { semanticReviewInitial: unknown[]; [key: string]: unknown };
    }>;
    expect(response.status).toBe(200);
    expect(generated.data.outputJson.writingStyle.styleVersionId).toBe(versionId);
    expect(generated.data.styleTraceJson.stageTimings).toHaveProperty("generate");
    expect(generated.data.tokenUsageJson).toHaveProperty("writing");
    expect(generated.data.tokenUsageJson.semanticReviewInitial).toHaveLength(2);
    expect(JSON.stringify(generated.data.styleTraceJson)).not.toContain("SECRET_WORLD_FACT");

    response = await app.request(`/api/v1/books/${book.data.id}/chapters/${chapterId}/polish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sceneType: "action" })
    });
    const polished = (await response.json()) as ApiPayload<{
      outputJson: { writingStyle: { styleVersionId: string; constraintHash: string } };
    }>;
    expect(response.status).toBe(200);
    expect(polished.data.outputJson.writingStyle.styleVersionId).toBe(versionId);
    expect(polished.data.outputJson.writingStyle.constraintHash).toBe(generated.data.outputJson.writingStyle.constraintHash);
  });
});

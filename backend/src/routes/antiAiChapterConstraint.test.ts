import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";

interface Payload<T> { data: T; }
let tempRoot: string | null = null;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-anti-ai-chapter-"));
  process.env.INK_AGENT_DATA_DIR = tempRoot;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  delete process.env.INK_AGENT_DATA_DIR;
  tempRoot = null;
});

describe("global anti-ai chapter constraint", () => {
  it("injects the baseline when the book has no writing style", async () => {
    const app = createApp();
    let response = await app.request("/api/v1/model-configs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Writer",
        provider: "openai-compatible",
        baseUrl: "https://models.example/v1",
        apiKey: "test-key",
        apiModel: "novel-model",
        purpose: "writing"
      })
    });
    const modelId = ((await response.json()) as Payload<{ id: string }>).data.id;
    await app.request("/api/v1/model-routes/writing", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelConfigId: modelId })
    });
    response = await app.request("/api/v1/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "无风格全局约束" })
    });
    const bookId = ((await response.json()) as Payload<{ id: string }>).data.id;
    response = await app.request(`/api/v1/books/${bookId}/chapters`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "第一章", content: "门外传来脚步声。" })
    });
    const chapterId = ((await response.json()) as Payload<{ id: string }>).data.id;

    let systemPrompt = "";
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      systemPrompt = body.messages[0]?.content ?? "";
      return new Response(JSON.stringify({ choices: [{ message: { content: "她握住门把，等那脚步停下。" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }));

    response = await app.request(`/api/v1/books/${bookId}/chapters/${chapterId}/continue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    const payload = (await response.json()) as Payload<{ outputJson: { antiAiPolicy: { ruleSetVersion: string } } }>;

    expect(response.status).toBe(200);
    expect(systemPrompt).toContain("【正文生成约束】");
    expect(systemPrompt).toContain("只写小说正文");
    expect(payload.data.outputJson.antiAiPolicy.ruleSetVersion).toBe("anti-ai-rules.v1");
  });
});


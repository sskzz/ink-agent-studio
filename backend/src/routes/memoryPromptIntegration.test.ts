// 偏好记忆提示词集成测试：仅已批准偏好注入写作/审稿/润色提示词，且不覆盖 BookState。
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { ensureWorkspace } from "../modules/workspace/workspaceService.js";
import { createApplicationServices, type ApplicationServices } from "../runtime/applicationServices.js";

interface ApiPayload<T> { data: T; }

let root: string | null = null;
let services: ApplicationServices | null = null;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "ink-agent-memory-prompt-"));
  process.env.INK_AGENT_DATA_DIR = root;
  const paths = createWorkspacePaths(root);
  await ensureWorkspace(paths);
  services = createApplicationServices(paths);
  const config = await services.configService.initialize();
  await services.runtimeDatabase.initialize({ busyTimeoutMs: config.storage.sqliteBusyTimeoutMs, backupBeforeMigration: false });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  services?.runtimeDatabase.close();
  services = null;
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
  delete process.env.INK_AGENT_DATA_DIR;
});

describe("memory prompt integration", () => {
  it("injects only approved preferences into writing review and polish prompts", async () => {
    const app = createApp(services!);
    const createProposal = async (value: string) => {
      const response = await app.request("/api/v1/memory/preferences/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: "writing",
          key: value.includes("APPROVED") ? "paragraph_length" : "dialogue_density",
          value,
          reason: "集成测试稳定偏好",
          priority: 80,
          sourceSessionId: null,
          sourceMessageId: null
        })
      });
      return ((await response.json()) as ApiPayload<{ id: string }>).data.id;
    };
    const approvedId = await createProposal("APPROVED_MEMORY_短段落");
    await createProposal("PROPOSED_MEMORY_增加对白");
    let response = await app.request(`/api/v1/memory/preferences/${approvedId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: true })
    });
    expect(response.status).toBe(200);

    response = await app.request("/api/v1/model-configs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Memory integration model",
        provider: "openai-compatible",
        baseUrl: "https://models.example/v1",
        apiKey: "test-key",
        apiModel: "novel-model",
        purpose: "writing"
      })
    });
    const modelId = ((await response.json()) as ApiPayload<{ id: string }>).data.id;
    for (const route of ["writing", "review"]) {
      await app.request(`/api/v1/model-routes/${route}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelConfigId: modelId })
      });
    }

    response = await app.request("/api/v1/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Memory Prompt 测试", chapterWords: 800 })
    });
    const bookId = ((await response.json()) as ApiPayload<{ id: string }>).data.id;
    response = await app.request(`/api/v1/books/${bookId}/chapters`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "第一章", content: "门外传来脚步声。" })
    });
    const chapterId = ((await response.json()) as ApiPayload<{ id: string }>).data.id;

    const prompts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      const prompt = body.messages.map((message) => message.content).join("\n");
      prompts.push(prompt);
      const content = prompt.includes("semantic-style-review.v1")
        ? JSON.stringify({ schemaVersion: "semantic-style-review.v1", passed: true, score: 95, violations: [], warnings: [] })
        : "她按住门把。脚步停了。";
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }));

    for (const operation of ["continue", "review", "polish"]) {
      response = await app.request(`/api/v1/books/${bookId}/chapters/${chapterId}/${operation}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction: "按要求处理", allowDegradedStyle: true })
      });
      expect(response.status).toBe(200);
    }

    expect(prompts.length).toBeGreaterThanOrEqual(4);
    expect(prompts.every((prompt) => prompt.includes("APPROVED_MEMORY_短段落"))).toBe(true);
    expect(prompts.every((prompt) => !prompt.includes("PROPOSED_MEMORY_增加对白"))).toBe(true);
    expect(prompts.every((prompt) => prompt.includes("不得覆盖 BookState"))).toBe(true);
  });
});

// 模型配置路由测试：路由就绪判定、模型发现去重排序、HTML 错误响应、规划模型生成 v3 风格分析。
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";

interface ApiPayload<T> {
  data: T;
}

let tempRoot: string | null = null;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-model-routes-"));
  process.env.INK_AGENT_DATA_DIR = tempRoot;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
  delete process.env.INK_AGENT_DATA_DIR;
});

describe("model configuration routes", () => {
  it("persists DeepSeek thinking mode configuration on save and read-back", async () => {
    const app = createApp();
    let response = await app.request("/api/v1/model-configs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "DeepSeek planner",
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com",
        apiModel: "deepseek-v4-flash",
        purpose: "planning",
        thinking: { enabled: true, effort: "max" }
      })
    });
    const created = (await response.json()) as ApiPayload<{ id: string }>;
    const createdId = created.data.id;

    response = await app.request(`/api/v1/model-configs/${createdId}`);
    const detail = (await response.json()) as ApiPayload<{ thinking: { enabled: boolean; effort: string } }>;
    expect(detail.data.thinking).toEqual({ enabled: true, effort: "max" });
  });

  it("defaults missing thinking configuration to null for compatibility", async () => {
    const app = createApp();
    const response = await app.request("/api/v1/model-configs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Legacy model",
        provider: "openai-compatible",
        baseUrl: "https://models.example/v1",
        apiModel: "legacy-chat",
        purpose: "writing"
      })
    });
    const payload = (await response.json()) as ApiPayload<{ thinking: unknown }>;
    expect(payload.data.thinking).toBeNull();
  });

  it("treats an enabled assigned model as route-ready regardless of its purpose label", async () => {
    const app = createApp();
    let response = await app.request("/api/v1/model-configs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Shared model",
        provider: "openai-compatible",
        baseUrl: "https://models.example/v1",
        apiKey: "test-key",
        apiModel: "shared-chat",
        purpose: "writing"
      })
    });
    const created = (await response.json()) as ApiPayload<{ id: string }>;

    response = await app.request("/api/v1/model-routes/review", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelConfigId: created.data.id })
    });
    expect(response.status).toBe(200);

    response = await app.request("/api/v1/model-analysis");
    const analysis = (await response.json()) as ApiPayload<{
      routes: Array<{ routeKey: string; ready: boolean; issues: string[] }>;
    }>;
    const reviewRoute = analysis.data.routes.find((route) => route.routeKey === "reviewModelId");
    expect(reviewRoute).toMatchObject({ ready: true, issues: [] });
  });

  it("discovers, deduplicates and sorts models exposed by the configured API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ data: [{ id: "model-z" }, { id: "model-a" }, { id: "model-z" }] }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );
    const app = createApp();
    const response = await app.request("/api/v1/model-configs/discover-models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "openai-compatible",
        baseUrl: "https://models.example/v1",
        apiKey: "test-key"
      })
    });
    const payload = (await response.json()) as ApiPayload<{ models: string[] }>;

    expect(response.status).toBe(200);
    expect(payload.data.models).toEqual(["model-a", "model-z"]);
    expect(fetch).toHaveBeenCalledWith(
      "https://models.example/v1/models",
      expect.objectContaining({ headers: { Authorization: "Bearer test-key" } })
    );
  });

  it("returns a readable discovery error when the model API returns HTML", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("<!doctype html><html><body>login</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" }
        })
      )
    );
    const app = createApp();
    const response = await app.request("/api/v1/model-configs/discover-models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "openai-compatible",
        baseUrl: "https://models.example/v1",
        apiKey: "test-key"
      })
    });
    const payload = (await response.json()) as { message: string };

    expect(response.status).toBe(400);
    expect(payload.message).toContain("接口返回了 HTML");
  });

  it("uses the configured planning model to produce v3 writing style analysis", async () => {
    const app = createApp();
    let response = await app.request("/api/v1/model-configs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Planning model",
        provider: "openai-compatible",
        baseUrl: "https://models.example/v1",
        apiKey: "test-key",
        apiModel: "planner-model",
        purpose: "planning"
      })
    });
    const created = (await response.json()) as ApiPayload<{ id: string }>;

    response = await app.request("/api/v1/model-routes/planning", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelConfigId: created.data.id })
    });
    expect(response.status).toBe(200);

    const modelAnalysis = {
      schemaVersion: "style-analysis.v3",
      summary: "冷静贴身视角，适合悬疑场景。",
      voiceProfile: "语气克制，贴近人物当下观察。",
      structureRule: "短段推进，段尾保留信息空白。",
      aiReductionRule: "避免段尾总结，改用动作和环境反馈。",
      stylePromptSnippet: "使用冷静贴身视角，短段推进，情绪不直说。",
      reviewPromptSnippet: "检查是否保持贴身视角，并删去段尾总结。",
      parameters: {
        tone: "冷静克制",
        register: "书面克制",
        pointOfView: "第三人称贴身",
        cameraDistance: "贴身",
        sentencePattern: "短中句交替",
        paragraphPattern: "短段推进",
        dialogueStyle: "少量潜台词",
        descriptionFocus: "动作与环境",
        emotionStyle: "间接呈现",
        narrativeDrive: "信息差",
        pacing: "短句推进",
        sceneSuitability: "悬疑与心理场景",
        aiReduction: "动作替代总结",
        confidence: 82
      },
      dominantStyle: {
        name: "冷静悬疑",
        description: "样本以克制观察和信息延迟为主。",
        strength: 82
      },
      secondaryStyles: [],
      executableRules: {
        narrativeRules: [{ rule: "保持第三人称贴身视角。", reason: "样本贴近人物感知。", priority: 1 }],
        languageRules: [{ rule: "使用短中句交替。", reason: "句式推进较紧。", priority: 1 }],
        rhythmRules: [{ rule: "用短段制造停顿。", reason: "段落切分明显。", priority: 1 }],
        dialogueRules: [{ rule: "对白保留潜台词。", reason: "信息不一次说满。", priority: 2 }],
        descriptionRules: [{ rule: "动作和环境优先。", reason: "情绪依靠外部细节。", priority: 1 }],
        emotionRules: [{ rule: "情绪不直接总结。", reason: "样本以反应承接。", priority: 1 }]
      },
      antiAiProfile: {
        riskLevel: "medium",
        mainRisks: ["段尾总结"],
        naturalnessPrinciple: "让动作和环境承接情绪。"
      },
      antiAiRules: [
        {
          type: "forbidden",
          category: "emotion",
          rule: "禁止段尾总结情绪。",
          detectHint: "检查段尾抽象总结。",
          rewriteHint: "改为动作或沉默。",
          severity: "high"
        },
        {
          type: "risk",
          category: "logic",
          rule: "避免解释完整心理因果。",
          detectHint: "检查连续心理解释。",
          rewriteHint: "改为行为选择。",
          severity: "medium"
        },
        {
          type: "risk",
          category: "language",
          rule: "避免工整排比。",
          detectHint: "检查连续对称句。",
          rewriteHint: "打散句式。",
          severity: "medium"
        },
        {
          type: "encourage",
          category: "dialogue",
          rule: "鼓励对白保留未说完的信息。",
          detectHint: "检查对白是否过满。",
          rewriteHint: "删除直白解释。",
          severity: "low"
        }
      ],
      styleBoundaries: {
        bestFor: ["悬疑场景"],
        avoidFor: ["高密度说明文"],
        mustKeep: ["贴身视角"],
        canVary: ["对白比例"]
      },
      evidence: [{ feature: "短段推进", reason: "样本切分明显。", snippet: "门没有关" }],
      warnings: []
    };
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model: string; messages: Array<{ content: string }> };
      expect(String(url)).toBe("https://models.example/v1/chat/completions");
      expect(body.model).toBe("planner-model");
      expect(body.messages[1]?.content).toContain("去 AI 味");

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(modelAnalysis) } }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    response = await app.request("/api/v1/writing-styles/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "悬疑模板",
        sampleFileName: "sample.md",
        content: "门没有关。\n她停在原地，没有说话。"
      })
    });
    const payload = (await response.json()) as ApiPayload<{
      analysis: { schemaVersion: string; antiAiRules: unknown[] };
      parameters: { tone: string };
      featureProfile: { schemaVersion: string; metrics: Record<string, number> };
    }>;

    expect(response.status).toBe(200);
    expect(payload.data.analysis.schemaVersion).toBe("style-analysis.v3");
    expect(payload.data.analysis.antiAiRules).toHaveLength(4);
    expect(payload.data.parameters.tone).toBe("冷静克制");
    expect(payload.data.featureProfile.schemaVersion).toBe("style-features.v2");
    expect(payload.data.featureProfile.metrics).toHaveProperty("averageSentenceLength");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

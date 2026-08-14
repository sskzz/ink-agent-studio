import { describe, expect, it } from "vitest";
import type { AppConfig } from "@ink-agent/contracts";
import type { ModelConfigRecord } from "../../types/domain.js";
import { checkContextWindow } from "./contextWindowGuard.js";

const contextConfig: AppConfig["context"] = {
  defaultContextWindow: 8_192,
  defaultMaxOutputTokens: 2_048,
  safetyMarginRatio: 0.1,
  compressionThresholdRatio: 0.8,
  retrievalMode: "targeted",
  budgets: {
    stableMaxTokens: 1_000,
    factsMaxTokens: 1_000,
    sceneMaxTokens: 1_000,
    recentMaxTokens: 1_000,
    sessionMaxTokens: 1_000,
    skillsMaxTokens: 1_000,
    turnMinTokens: 256
  }
};

function model(provider: ModelConfigRecord["provider"], capabilities: ModelConfigRecord["capabilities"] = {}): ModelConfigRecord {
  return {
    id: "model-1",
    name: "测试模型",
    provider,
    baseUrl: "http://localhost",
    apiModel: "test",
    purpose: "writing",
    enabled: true,
    isDefault: true,
    capabilities,
    thinking: provider === "deepseek" ? { enabled: true, effort: "high" } : null,
    note: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

describe("checkContextWindow", () => {
  it("普通模型在输入、输出和安全余量均能容纳时通过", () => {
    const result = checkContextWindow(model("openai-compatible", { contextWindow: 8_192 }), {
      systemPrompt: "规则",
      userPrompt: "上下文",
      maxTokens: 1_000
    }, contextConfig);

    expect(result.ok).toBe(true);
    expect(result.budget.reasoningReserveTokens).toBe(0);
  });

  it("DeepSeek 思考预算与正文输出统一计入窗口和输出上限", () => {
    const result = checkContextWindow(model("deepseek", {
      contextWindow: 8_192,
      maxOutputTokens: 5_000,
      reasoningReserveTokens: 4_096
    }), {
      systemPrompt: "规则",
      userPrompt: "上下文",
      maxTokens: 1_200
    }, contextConfig);

    expect(result.ok).toBe(false);
    expect(result.budget.providerMaxTokens).toBe(5_296);
    if (!result.ok) expect(result.message).toContain("模型输出上限");
  });

  it("总预算超过上下文窗口时在发出请求前拒绝", () => {
    const result = checkContextWindow(model("openai-compatible", { contextWindow: 4_096 }), {
      systemPrompt: "规".repeat(1_500),
      userPrompt: "文".repeat(1_500),
      maxTokens: 1_000
    }, contextConfig);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("上下文预算不足");
  });
});

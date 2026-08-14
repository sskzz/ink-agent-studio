import type { AppConfig } from "@ink-agent/contracts";
import type { ModelConfigRecord } from "../../types/domain.js";
import { estimateTokens } from "./promptAssembler.js";

export interface ContextWindowBudget {
  contextWindow: number;
  inputEstimatedTokens: number;
  requestedOutputTokens: number;
  reasoningReserveTokens: number;
  safetyMarginTokens: number;
  providerMaxTokens: number;
  totalReservedTokens: number;
}

export type ContextWindowCheck =
  | { ok: true; budget: ContextWindowBudget }
  | { ok: false; budget: ContextWindowBudget; message: string };

/** 在请求进入 provider adapter 前统一核算输入、正文输出、思考预算和安全余量。 */
export function checkContextWindow(
  model: ModelConfigRecord,
  input: { systemPrompt: string; userPrompt: string; maxTokens?: number },
  config: AppConfig["context"]
): ContextWindowCheck {
  const contextWindow = model.capabilities.contextWindow ?? config.defaultContextWindow;
  const requestedOutputTokens = input.maxTokens ?? config.defaultMaxOutputTokens;
  const thinkingEnabled = model.provider === "deepseek" && (model.thinking?.enabled ?? true);
  const reasoningReserveTokens = thinkingEnabled
    ? model.capabilities.reasoningReserveTokens ?? 4_096
    : 0;
  const inputEstimatedTokens = estimateTokens(`${input.systemPrompt}\n\n${input.userPrompt}`);
  const safetyMarginTokens = Math.ceil(contextWindow * config.safetyMarginRatio);
  const providerMaxTokens = requestedOutputTokens + reasoningReserveTokens;
  const totalReservedTokens = inputEstimatedTokens + providerMaxTokens + safetyMarginTokens;
  const budget: ContextWindowBudget = {
    contextWindow,
    inputEstimatedTokens,
    requestedOutputTokens,
    reasoningReserveTokens,
    safetyMarginTokens,
    providerMaxTokens,
    totalReservedTokens
  };

  if (model.capabilities.maxOutputTokens !== undefined && providerMaxTokens > model.capabilities.maxOutputTokens) {
    return {
      ok: false,
      budget,
      message: `正文输出与思考预留合计 ${providerMaxTokens} 超过模型输出上限 ${model.capabilities.maxOutputTokens}`
    };
  }
  if (totalReservedTokens > contextWindow) {
    return {
      ok: false,
      budget,
      message: `上下文预算不足：预计占用 ${totalReservedTokens}，模型窗口 ${contextWindow}`
    };
  }
  return { ok: true, budget };
}

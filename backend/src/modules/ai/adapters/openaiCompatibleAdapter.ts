import type { ModelConfigRecord } from "../../../types/domain.js";
import type { ModelProviderAdapter } from "../types.js";
import { modelTestResult } from "../types.js";
import { parseOpenAIModelListResponse } from "./modelListResponse.js";

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

async function requestModels(config: ModelConfigRecord, apiKey: string) {
  return fetch(`${normalizeBaseUrl(config.baseUrl)}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(8000)
  });
}

/**
 * OpenAI 兼容连接测试。
 * 这里优先请求 /models，因为它不消耗生成 token，适合做轻量连通性检查。
 */
export const openaiCompatibleAdapter: ModelProviderAdapter = {
  providerType: "openai-compatible",

  async listModels(config, apiKey) {
    const response = await requestModels(config, apiKey);
    return parseOpenAIModelListResponse(response, "获取模型列表失败");
  },

  async test(config: ModelConfigRecord, apiKey: string) {
    const response = await requestModels(config, apiKey);

    if (!response.ok) {
      return modelTestResult(config, false, `连接失败：HTTP ${response.status}`, {
        status: response.status,
        statusText: response.statusText
      });
    }

    await parseOpenAIModelListResponse(response, "连接失败");
    return modelTestResult(config, true, "OpenAI 兼容服务连接成功");
  }
};

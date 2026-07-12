import type { ModelProviderAdapter } from "../types.js";
import { modelTestResult } from "../types.js";
import { parseOpenAIModelListResponse } from "./modelListResponse.js";

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

/**
 * Ollama 默认兼容 OpenAI /v1/models。
 * 本地模型通常不需要 API Key，因此这里不强制校验密钥。
 */
export const ollamaAdapter: ModelProviderAdapter = {
  providerType: "ollama",

  async listModels(config, apiKey) {
    const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(5000)
    });

    return parseOpenAIModelListResponse(response, "获取 Ollama 模型列表失败");
  },

  async test(config) {
    const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/models`, {
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      return modelTestResult(config, false, `Ollama 连接失败：HTTP ${response.status}`, {
        status: response.status,
        statusText: response.statusText
      });
    }

    await parseOpenAIModelListResponse(response, "Ollama 连接失败");
    return modelTestResult(config, true, "Ollama 本地模型服务连接成功");
  }
};

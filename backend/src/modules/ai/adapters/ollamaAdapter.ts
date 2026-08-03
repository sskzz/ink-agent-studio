/**
 * 文件职责：Ollama 本地模型服务 adapter。
 * 边界：复用 OpenAI 兼容的 /models 解析与文本生成实现；本地模型通常免密钥，因此不强制校验。
 */
import type { ModelProviderAdapter } from "../types.js";
import { modelTestResult } from "../types.js";
import { parseOpenAIModelListResponse } from "./modelListResponse.js";
import { openaiCompatibleAdapter } from "./openaiCompatibleAdapter.js";

/** 去掉 Base URL 末尾多余的斜杠，避免拼出双斜杠路径。 */
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
      // Ollama 可选鉴权：仅在用户配置了密钥时附带，未配置也能直接请求本地服务
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

    // 能取到模型列表即视为连通，返回 ok=true
    await parseOpenAIModelListResponse(response, "Ollama 连接失败");
    return modelTestResult(config, true, "Ollama 本地模型服务连接成功");
  },

  async generateText(config, apiKey, input) {
    if (!openaiCompatibleAdapter.generateText) {
      throw new Error("OpenAI Compatible adapter 未实现文本生成");
    }
    return openaiCompatibleAdapter.generateText(config, apiKey, input);
  }
};

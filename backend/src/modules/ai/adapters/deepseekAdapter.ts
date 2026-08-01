import type { ModelProviderAdapter } from "../types.js";
import { openaiCompatibleAdapter } from "./openaiCompatibleAdapter.js";

/**
 * DeepSeek 官方 API 兼容 OpenAI Chat 协议。
 * 第一版复用 OpenAI Compatible 连接测试逻辑，后续如果要补充 DeepSeek 专属能力再单独扩展。
 */
export const deepseekAdapter: ModelProviderAdapter = {
  providerType: "deepseek",

  async listModels(config, apiKey) {
    return openaiCompatibleAdapter.listModels(config, apiKey);
  },

  async test(config, apiKey) {
    return openaiCompatibleAdapter.test(config, apiKey);
  },

  async generateText(config, apiKey, input) {
    if (!openaiCompatibleAdapter.generateText) {
      throw new Error("OpenAI Compatible adapter 未实现文本生成");
    }

    return openaiCompatibleAdapter.generateText(config, apiKey, input);
  }
};

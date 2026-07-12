import { getModelSecret } from "../models/secretStore.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { deepseekAdapter } from "./adapters/deepseekAdapter.js";
import { ollamaAdapter } from "./adapters/ollamaAdapter.js";
import { openaiCompatibleAdapter } from "./adapters/openaiCompatibleAdapter.js";
import type { ModelProviderAdapter } from "./types.js";
import { modelTestResult } from "./types.js";
import type { ModelConfigRecord } from "../../types/domain.js";

const adapters = new Map<string, ModelProviderAdapter>([
  [openaiCompatibleAdapter.providerType, openaiCompatibleAdapter],
  [ollamaAdapter.providerType, ollamaAdapter],
  [deepseekAdapter.providerType, deepseekAdapter]
]);

export function hasModelProviderAdapter(provider: string) {
  return adapters.has(provider);
}

export async function listAvailableModels(paths: WorkspacePaths, config: ModelConfigRecord, apiKeyOverride = "") {
  const adapter = adapters.get(config.provider);

  if (!adapter) {
    throw new Error(`暂未实现 ${config.provider} 的模型列表适配器`);
  }

  const apiKey = apiKeyOverride || (config.id ? await getModelSecret(paths, config.id) : "");
  return adapter.listModels(config, apiKey);
}

/**
 * 统一模型网关。
 * 业务模块只能调用这里，不能直接调用厂商 SDK 或 adapter，方便后续统一加重试、fallback、日志和 Token 统计。
 */
export async function testModelConnection(paths: WorkspacePaths, config: ModelConfigRecord, apiKeyOverride = "") {
  const adapter = adapters.get(config.provider);

  if (!adapter) {
    return modelTestResult(config, false, `暂未实现 ${config.provider} 的连接测试 adapter`);
  }

  const apiKey = apiKeyOverride || (await getModelSecret(paths, config.id));

  try {
    return await adapter.test(config, apiKey);
  } catch (error) {
    return modelTestResult(config, false, "模型连接测试异常", {
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

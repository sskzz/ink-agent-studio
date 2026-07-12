import type { ModelConfigRecord, ModelProvider } from "../../types/domain.js";

export interface ModelTestResult {
  ok: boolean;
  message: string;
  provider: ModelProvider;
  checkedAt: string;
  details?: unknown;
}

export interface ModelProviderAdapter {
  providerType: ModelProvider;
  test(config: ModelConfigRecord, apiKey: string): Promise<ModelTestResult>;
  listModels(config: ModelConfigRecord, apiKey: string): Promise<string[]>;
}

export function modelTestResult(
  config: ModelConfigRecord,
  ok: boolean,
  message: string,
  details?: unknown
): ModelTestResult {
  return {
    ok,
    message,
    provider: config.provider,
    checkedAt: new Date().toISOString(),
    details
  };
}

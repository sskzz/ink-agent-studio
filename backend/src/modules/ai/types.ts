import type { ModelConfigRecord, ModelProvider } from "../../types/domain.js";

export interface ModelTestResult {
  ok: boolean;
  message: string;
  provider: ModelProvider;
  checkedAt: string;
  details?: unknown;
}

export interface ModelGenerateTextInput {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "json_object" | "text";
  stream?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ModelGenerateTextResult {
  text: string;
  provider: ModelProvider;
  model: string;
  raw?: unknown;
  tokenUsage?: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  };
}

export interface ModelProviderAdapter {
  providerType: ModelProvider;
  test(config: ModelConfigRecord, apiKey: string): Promise<ModelTestResult>;
  listModels(config: ModelConfigRecord, apiKey: string): Promise<string[]>;
  generateText?(
    config: ModelConfigRecord,
    apiKey: string,
    input: ModelGenerateTextInput
  ): Promise<ModelGenerateTextResult>;
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

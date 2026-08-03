/**
 * 文件职责：模型网关与各 adapter 共享的类型定义（输入、输出、适配器契约）与结果构造工具。
 * 边界：只定义契约与纯函数，不包含任何网络或模型调用实现。
 */
import type { ModelConfigRecord, ModelProvider } from "../../types/domain.js";

/** 连接测试结果：ok 为是否连通，details 保留厂商侧的状态信息供展示。 */
export interface ModelTestResult {
  ok: boolean;
  message: string;
  provider: ModelProvider;
  checkedAt: string;
  details?: unknown;
}

/** 文本生成请求：prompt 加可选参数（温度、长度、JSON 输出、流式、超时、取消信号）。 */
export interface ModelGenerateTextInput {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "json_object" | "text";
  stream?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** 流式模式下每个文本片段的回调，用于把模型生成过程中的返回实时上报。 */
  onDelta?: (delta: string) => void;
}

/** 文本生成结果：正文、来源模型信息、原始响应与 token 用量（用于成本估算与审计）。 */
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

/** 服务商适配器契约：连接测试、模型列表与（可选的）文本生成，由具体厂商实现。 */
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

/** 构造标准连接测试结果，统一记录服务商与检查时间。 */
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

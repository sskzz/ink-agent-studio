/**
 * 文件职责：OpenAI 兼容协议 adapter（兼容 OpenAI / One API / LiteLLM / 各类中转站）。
 * 边界：实现连接测试、模型列表与文本生成（含 SSE 流式）；错误统一交给网关错误工具分类。
 */
import type { ModelConfigRecord } from "../../../types/domain.js";
import { createTimedAbortSignal } from "../abortSignals.js";
import {
  createHttpModelGatewayError,
  ModelGatewayError,
  malformedModelResponse,
  normalizeModelGatewayError
} from "../modelGatewayError.js";
import type { ModelGenerateTextInput, ModelProviderAdapter } from "../types.js";
import { modelTestResult } from "../types.js";
import { parseOpenAIModelListResponse } from "./modelListResponse.js";

/** 去掉 Base URL 末尾多余的斜杠，避免拼出双斜杠路径。 */
function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

/**
 * 把模型配置的思考模式设置翻译为 DeepSeek 请求体参数。
 * effort 为 null 时不发送 reasoning_effort（使用服务商默认档位）。
 */
function deepseekThinkingBody(thinking: { enabled: boolean; effort: "low" | "high" | "max" | null }) {
  return {
    thinking: { type: thinking.enabled ? "enabled" : "disabled" },
    ...(thinking.effort ? { reasoning_effort: thinking.effort } : {})
  };
}

/** 请求 /models：连接测试与模型列表共用，8 秒硬超时避免长期挂起。 */
async function requestModels(config: ModelConfigRecord, apiKey: string) {
  return fetch(`${normalizeBaseUrl(config.baseUrl)}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(8000)
  });
}

/**
 * 发起 /chat/completions 请求。
 * 通过组合信号同时受外部取消与本次调用超时约束；返回 cleanup 供调用方在 finally 中释放定时器。
 * 请求体优化（依据 DeepSeek 官方文档）：
 * - 流式请求附带 stream_options.include_usage，让最后一个 chunk 携带完整 usage（Ollama 不识别该字段，跳过）；
 * - DeepSeek V4 思考模式由模型配置（thinking.enabled / thinking.effort）控制；
 *   旧配置未保存该字段时回退为“开启 + max”，与历史行为保持一致。
 */
async function requestChatCompletions(config: ModelConfigRecord, apiKey: string, input: ModelGenerateTextInput) {
  const thinkingBody = config.provider === "deepseek"
    ? deepseekThinkingBody(config.thinking ?? { enabled: true, effort: "max" })
    : null;
  const body = {
    model: config.apiModel,
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userPrompt }
    ],
    temperature: input.temperature ?? 0.25,
    // max_tokens 已由模型网关统一计入正文输出与思考预留，adapter 不再暗加预算。
    max_tokens: input.maxTokens ?? 2800,
    ...(input.stream ? { stream: true } : {}),
    ...(input.responseFormat === "json_object" ? { response_format: { type: "json_object" } } : {}),
    ...(input.stream && config.provider !== "ollama" ? { stream_options: { include_usage: true } } : {}),
    ...(thinkingBody ?? {})
  };

  const timedSignal = createTimedAbortSignal(input.signal, input.timeoutMs ?? 30000);
  try {
    const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify(body),
      signal: timedSignal.signal
    });
    return { response, signal: timedSignal.signal, cleanup: timedSignal.cleanup };
  } catch (error) {
    timedSignal.cleanup();
    throw normalizeModelGatewayError(error, input.signal);
  }
}

/**
 * 读取错误响应体中的具体原因（仅提取 error.message 字符串，截断防超长）。
 * 返回 undefined 表示没有可用信息；读取会消费响应体，只在即将抛错时调用。
 */
async function readErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const raw = (await response.text()).slice(0, 2_000);
    const parsed = JSON.parse(raw) as { error?: { message?: unknown } } | null;
    const message = typeof parsed?.error?.message === "string" ? parsed.error.message.trim() : "";
    return message ? message.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 解析 chat 响应：非 2xx 按状态码分类；流式请求或返回 data: 前缀时走 SSE 解析，否则按 JSON 解析。
 * @throws ModelGatewayError（HTTP 错误 / malformed_response）
 */
async function parseChatCompletionResponse(
  config: ModelConfigRecord,
  response: Response,
  streamRequested = false,
  onDelta?: (chunk: string) => void
) {
  if (!response.ok) {
    throw createHttpModelGatewayError(response.status, await readErrorDetail(response));
  }

  const rawText = await response.text();

  if (streamRequested || rawText.trimStart().startsWith("data:")) {
    return parseStreamingChatCompletion(config, rawText, onDelta);
  }

  let payload: unknown;

  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch (error) {
    throw malformedModelResponse(error);
  }

  const choices = typeof payload === "object" && payload !== null ? (payload as { choices?: unknown }).choices : null;
  const firstChoice = Array.isArray(choices) ? choices[0] : null;
  const message =
    typeof firstChoice === "object" && firstChoice !== null
      ? (firstChoice as { message?: { content?: unknown } }).message
      : null;
  const content = typeof message?.content === "string" ? message.content.trim() : "";
  const usage = typeof payload === "object" && payload !== null ? (payload as { usage?: Record<string, unknown> }).usage : undefined;

  // 空内容视为无效响应（如仅返回 usage 的异常响应），交给网关按 malformed 处理
  if (!content) {
    throw malformedModelResponse();
  }

  return {
    text: content,
    provider: config.provider,
    model: config.apiModel,
    raw: payload,
    tokenUsage: {
      promptTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
      completionTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
      totalTokens: typeof usage?.total_tokens === "number" ? usage.total_tokens : null
    }
  };
}

/**
 * 解析 SSE 流式响应：逐行读取 data: 载荷，拼接 delta.content；兼容部分厂商用 message 字段
 * 替代 delta 的实现；[DONE] 与空行直接跳过；没有任何正文则视为无效响应。
 */
function parseStreamingChatCompletion(config: ModelConfigRecord, rawText: string, onDelta?: (chunk: string) => void) {
  let content = "";
  let chunkCount = 0;
  let usage: Record<string, unknown> | undefined;

  for (const line of rawText.split(/\r?\n/)) {
    const trimmed = line.trim();
    // 跳过空行、注释行（以冒号开头）与非 data 行
    if (!trimmed || trimmed.startsWith(":")) continue;
    if (!trimmed.startsWith("data:")) continue;

    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;

    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch (error) {
      throw malformedModelResponse(error);
    }

    chunkCount += 1;
    if (typeof payload !== "object" || payload === null) continue;
    const record = payload as { choices?: unknown; usage?: Record<string, unknown> };
    if (record.usage) usage = record.usage;
    const firstChoice = Array.isArray(record.choices) ? record.choices[0] : null;
    if (typeof firstChoice !== "object" || firstChoice === null) continue;
    const choice = firstChoice as {
      delta?: { content?: unknown };
      message?: { content?: unknown };
    };
    const chunk = typeof choice.delta?.content === "string"
      ? choice.delta.content
      : typeof choice.message?.content === "string"
        ? choice.message.content
        : "";
    if (chunk) {
      content += chunk;
      onDelta?.(chunk);
    }
  }

  const text = content.trim();
  if (!text) throw malformedModelResponse();

  return {
    text,
    provider: config.provider,
    model: config.apiModel,
    raw: { stream: true, chunkCount },
    tokenUsage: {
      promptTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
      completionTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
      totalTokens: typeof usage?.total_tokens === "number" ? usage.total_tokens : null
    }
  };
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
  },

  async generateText(config, apiKey, input) {
    const pending = await requestChatCompletions(config, apiKey, input);
    try {
      if (input.stream) {
        return await parseStreamingResponse(config, pending, input);
      }
      return await parseChatCompletionResponse(config, pending.response, false);
    } catch (error) {
      // 组合信号中止但外部信号未中止：说明是本次调用的超时而非用户取消，归为可重试的 timeout
      if (pending.signal.aborted && !input.signal?.aborted) {
        throw new ModelGatewayError({ kind: "timeout", retryable: true, cause: error });
      }
      throw normalizeModelGatewayError(error, input.signal);
    } finally {
      pending.cleanup();
    }
  }
};

/**
 * 真流式解析：逐块读取 response.body，边收边回调 onDelta。
 * 与整段缓冲（response.text()）相比，首个 token 到达即可上报，前端执行详情实时更新，
 * 用户感知延迟显著降低；中途取消（用户暂停/超时）会立即中止读取并向上抛错。
 */
async function parseStreamingResponse(
  config: ModelConfigRecord,
  pending: { response: Response; signal: AbortSignal },
  input: ModelGenerateTextInput
) {
  if (!pending.response.ok) {
    throw createHttpModelGatewayError(pending.response.status, await readErrorDetail(pending.response));
  }
  if (!pending.response.body) {
    // 服务端未返回可读流（异常场景）：回退到整段解析，保证功能可用。
    return parseChatCompletionResponse(config, pending.response, true, input.onDelta);
  }

  const reader = pending.response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let content = "";
  let chunkCount = 0;
  let usage: Record<string, unknown> | undefined;

  const handleLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line || !line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;

    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch (error) {
      throw malformedModelResponse(error);
    }
    chunkCount += 1;
    if (typeof payload !== "object" || payload === null) return;
    const record = payload as { choices?: unknown; usage?: Record<string, unknown> };
    if (record.usage) usage = record.usage;
    const firstChoice = Array.isArray(record.choices) ? record.choices[0] : null;
    if (typeof firstChoice !== "object" || firstChoice === null) return;
    const choice = firstChoice as {
      delta?: { content?: unknown; reasoning_content?: unknown };
      message?: { content?: unknown; reasoning_content?: unknown };
    };
    // 思考模式（DeepSeek V4）会先流式输出 reasoning_content 再输出正文：
    // 推理增量只用于前端“实时输出”展示，不并入返回文本（避免污染结构化 JSON）。
    const reasoningChunk = typeof choice.delta?.reasoning_content === "string"
      ? choice.delta.reasoning_content
      : typeof choice.message?.reasoning_content === "string"
        ? choice.message.reasoning_content
        : "";
    if (reasoningChunk) input.onDelta?.(reasoningChunk);
    const chunk = typeof choice.delta?.content === "string"
      ? choice.delta.content
      : typeof choice.message?.content === "string"
        ? choice.message.content
        : "";
    if (chunk) {
      content += chunk;
      input.onDelta?.(chunk);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      handleLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();

  const tail = buffer.trim();
  if (tail) handleLine(tail);

  const text = content.trim();
  if (!text) throw malformedModelResponse();

  return {
    text,
    provider: config.provider,
    model: config.apiModel,
    raw: { stream: true, chunkCount },
    tokenUsage: {
      promptTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
      completionTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
      totalTokens: typeof usage?.total_tokens === "number" ? usage.total_tokens : null
    }
  };
}

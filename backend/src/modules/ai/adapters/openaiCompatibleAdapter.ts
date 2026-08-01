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

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

async function requestModels(config: ModelConfigRecord, apiKey: string) {
  return fetch(`${normalizeBaseUrl(config.baseUrl)}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(8000)
  });
}

async function requestChatCompletions(config: ModelConfigRecord, apiKey: string, input: ModelGenerateTextInput) {
  const body = {
    model: config.apiModel,
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userPrompt }
    ],
    temperature: input.temperature ?? 0.25,
    max_tokens: input.maxTokens ?? 2800,
    ...(input.stream ? { stream: true } : {}),
    ...(input.responseFormat === "json_object" ? { response_format: { type: "json_object" } } : {})
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

async function parseChatCompletionResponse(
  config: ModelConfigRecord,
  response: Response,
  streamRequested = false
) {
  if (!response.ok) {
    throw createHttpModelGatewayError(response.status);
  }

  const rawText = await response.text();

  if (streamRequested || rawText.trimStart().startsWith("data:")) {
    return parseStreamingChatCompletion(config, rawText);
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

function parseStreamingChatCompletion(config: ModelConfigRecord, rawText: string) {
  let content = "";
  let chunkCount = 0;
  let usage: Record<string, unknown> | undefined;

  for (const line of rawText.split(/\r?\n/)) {
    const trimmed = line.trim();
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
    content += chunk;
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
      return await parseChatCompletionResponse(config, pending.response, input.stream);
    } catch (error) {
      if (pending.signal.aborted && !input.signal?.aborted) {
        throw new ModelGatewayError({ kind: "timeout", retryable: true, cause: error });
      }
      throw normalizeModelGatewayError(error, input.signal);
    } finally {
      pending.cleanup();
    }
  }
};

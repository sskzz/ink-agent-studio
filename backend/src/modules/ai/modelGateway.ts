import type { AppConfig } from "@ink-agent/contracts";
import { getModelSecret } from "../models/secretStore.js";
import { getModelRoutes, listModelConfigs } from "../models/modelConfigRepository.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { ConfigRepository } from "../../config/configRepository.js";
import type { ModelConfigRecord, ModelPurpose } from "../../types/domain.js";
import { sha256 } from "../../utils/hash.js";
import { abortableDelay, combineAbortSignals } from "./abortSignals.js";
import { deepseekAdapter } from "./adapters/deepseekAdapter.js";
import { ollamaAdapter } from "./adapters/ollamaAdapter.js";
import { openaiCompatibleAdapter } from "./adapters/openaiCompatibleAdapter.js";
import { getActiveModelExecutionContext } from "./modelExecutionContext.js";
import {
  ModelGatewayError,
  normalizeModelGatewayError,
  serializeModelGatewayError
} from "./modelGatewayError.js";
import type {
  ModelGenerateTextInput,
  ModelGenerateTextResult,
  ModelProviderAdapter
} from "./types.js";
import { modelTestResult } from "./types.js";

const adapters = new Map<string, ModelProviderAdapter>([
  [openaiCompatibleAdapter.providerType, openaiCompatibleAdapter],
  [ollamaAdapter.providerType, ollamaAdapter],
  [deepseekAdapter.providerType, deepseekAdapter]
]);

export interface ModelGatewayOptions {
  purpose?: Extract<ModelPurpose, "writing" | "review" | "planning">;
  fallbackModels?: ModelConfigRecord[];
  retry?: AppConfig["models"]["retry"];
  defaultTimeoutMs?: number;
  apiKeyOverride?: string;
  random?: () => number;
}

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
 * 统一模型网关。业务模块只调用这里，不直接调用厂商 SDK 或 adapter，确保重试、fallback、
 * 取消、模型尝试审计和成本估算遵循同一策略。
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

/** 保留原函数签名；现有同步 API 会自动获得配置文件中的重试和 fallback 策略。 */
export async function generateModelText(
  paths: WorkspacePaths,
  primaryModel: ModelConfigRecord,
  input: ModelGenerateTextInput,
  apiKeyOverride = ""
) {
  return generateModelTextWithFallback(paths, primaryModel, input, { apiKeyOverride });
}

export async function generateModelTextWithFallback(
  paths: WorkspacePaths,
  primaryModel: ModelConfigRecord,
  input: ModelGenerateTextInput,
  options: ModelGatewayOptions = {}
): Promise<ModelGenerateTextResult> {
  const activeContext = getActiveModelExecutionContext();
  const policy = activeContext?.modelPolicy ?? (await new ConfigRepository(paths).readOrCreate()).models;
  const retry = options.retry ?? policy.retry;
  assertRetryPolicy(retry);
  const purpose = options.purpose ?? normalizePurpose(primaryModel.purpose);
  const fallbackModels = options.fallbackModels ?? await selectFallbackModels(paths, primaryModel, purpose);
  const candidates = uniqueModels([primaryModel, ...fallbackModels]);
  const signal = combineAbortSignals(input.signal, activeContext?.signal);
  const timeoutMs = input.timeoutMs ?? options.defaultTimeoutMs ?? policy.defaultTimeoutMs;
  const requestHash = sha256(JSON.stringify({
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    responseFormat: input.responseFormat ?? "text",
    stream: input.stream ?? false,
    temperature: input.temperature ?? null,
    maxTokens: input.maxTokens ?? null
  }));
  const random = options.random ?? Math.random;
  let totalAttempts = 0;
  let lastError: ModelGatewayError | null = null;

  throwIfCancelled(signal);

  for (const model of candidates) {
    const adapter = adapters.get(model.provider);
    if (!model.enabled || !adapter?.generateText) continue;

    for (let modelAttempt = 1; modelAttempt <= retry.maxAttemptsPerModel; modelAttempt += 1) {
      if (totalAttempts >= retry.maxTotalAttempts) break;
      throwIfCancelled(signal);
      totalAttempts += 1;
      const startedAt = Date.now();
      const attempt = activeContext?.eventStore.startModelAttempt(activeContext.runId, {
        stage: activeContext.stage,
        purpose,
        modelConfigId: model.id,
        provider: model.provider,
        model: model.apiModel,
        attemptNumber: totalAttempts,
        requestHash
      });

      try {
        const apiKey = model.id === primaryModel.id && options.apiKeyOverride
          ? options.apiKeyOverride
          : await getModelSecret(paths, model.id);
        const result = await adapter.generateText(model, apiKey, {
          ...input,
          timeoutMs,
          signal
        });
        const estimatedCost = estimateModelCost(model, result);
        activeContext?.eventStore.finishModelAttempt(attempt!.id, {
          status: "completed",
          promptTokens: result.tokenUsage?.promptTokens ?? null,
          completionTokens: result.tokenUsage?.completionTokens ?? null,
          totalTokens: result.tokenUsage?.totalTokens ?? null,
          estimatedCostMicros: estimatedCost?.micros ?? null,
          costCurrency: estimatedCost?.currency ?? null,
          latencyMs: Date.now() - startedAt
        });
        return result;
      } catch (error) {
        const normalized = normalizeModelGatewayError(error, signal);
        lastError = normalized;
        activeContext?.eventStore.finishModelAttempt(attempt!.id, {
          status: toAttemptStatus(normalized),
          latencyMs: Date.now() - startedAt,
          error: serializeModelGatewayError(normalized)
        });

        if (!normalized.retryable) throw normalized;
        const hasAnotherAttemptForModel = modelAttempt < retry.maxAttemptsPerModel;
        const hasAttemptCapacity = totalAttempts < retry.maxTotalAttempts;
        if (hasAnotherAttemptForModel && hasAttemptCapacity) {
          try {
            await waitBeforeRetry(retry, modelAttempt, random, signal);
          } catch (delayError) {
            throw normalizeModelGatewayError(delayError, signal);
          }
        }
      }
    }

    if (totalAttempts >= retry.maxTotalAttempts) break;
  }

  if (lastError) throw lastError;
  throw new ModelGatewayError({
    kind: "invalid_request",
    retryable: false,
    message: "没有可用且已实现文本生成适配器的模型配置"
  });
}

async function selectFallbackModels(
  paths: WorkspacePaths,
  primary: ModelConfigRecord,
  purpose: Extract<ModelPurpose, "writing" | "review" | "planning">
) {
  const [configs, routes] = await Promise.all([
    listModelConfigs(paths),
    getModelRoutes(paths)
  ]);
  const routed = [routes.writingModelId, routes.reviewModelId, routes.planningModelId]
    .flatMap((modelId) => {
      const config = modelId ? configs.find((item) => item.id === modelId) : null;
      return config && config.id !== primary.id && config.enabled ? [config] : [];
    });
  const samePurpose = configs.filter((config) =>
    config.id !== primary.id && config.enabled && config.purpose === purpose
  );
  const compatibleDefault = configs.filter((config) =>
    config.id !== primary.id
    && config.enabled
    && config.isDefault
    && ["writing", "review", "planning"].includes(config.purpose)
  );
  return uniqueModels([...routed, ...samePurpose, ...compatibleDefault]);
}

function uniqueModels(models: ModelConfigRecord[]) {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

function normalizePurpose(purpose: ModelPurpose): Extract<ModelPurpose, "writing" | "review" | "planning"> {
  return ["writing", "review", "planning"].includes(purpose)
    ? purpose as Extract<ModelPurpose, "writing" | "review" | "planning">
    : "writing";
}

function assertRetryPolicy(retry: AppConfig["models"]["retry"]) {
  if (retry.maxAttemptsPerModel < 1 || retry.maxTotalAttempts < 1) {
    throw new Error("模型重试次数必须大于 0");
  }
}

async function waitBeforeRetry(
  retry: AppConfig["models"]["retry"],
  modelAttempt: number,
  random: () => number,
  signal?: AbortSignal
) {
  const exponential = retry.baseDelayMs * 2 ** Math.max(0, modelAttempt - 1);
  const jitter = 0.8 + Math.min(1, Math.max(0, random())) * 0.4;
  await abortableDelay(Math.min(retry.maxDelayMs, Math.round(exponential * jitter)), signal);
}

function toAttemptStatus(error: ModelGatewayError) {
  if (error.kind === "cancelled") return "cancelled" as const;
  if (error.kind === "timeout") return "timed_out" as const;
  return "failed" as const;
}

function throwIfCancelled(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new ModelGatewayError({ kind: "cancelled", retryable: false });
  }
}

function estimateModelCost(config: ModelConfigRecord, result: ModelGenerateTextResult) {
  const pricing = readPricing(config.capabilities.pricing);
  const promptTokens = result.tokenUsage?.promptTokens;
  const completionTokens = result.tokenUsage?.completionTokens;
  if (!pricing || promptTokens === null || promptTokens === undefined
    || completionTokens === null || completionTokens === undefined) return null;
  return {
    currency: pricing.currency,
    micros: Math.max(0, Math.round(
      (promptTokens * pricing.promptMicrosPerMillionTokens
      + completionTokens * pricing.completionMicrosPerMillionTokens) / 1_000_000
    ))
  };
}

function readPricing(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const pricing = value as Record<string, unknown>;
  const currency = pricing.currency;
  const prompt = pricing.promptMicrosPerMillionTokens;
  const completion = pricing.completionMicrosPerMillionTokens;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) return null;
  if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return null;
  if (Number(prompt) < 0 || Number(completion) < 0) return null;
  return {
    currency,
    promptMicrosPerMillionTokens: Number(prompt),
    completionMicrosPerMillionTokens: Number(completion)
  };
}

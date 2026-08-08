/**
 * 文件职责：统一模型网关。业务模块只通过这里调用模型，内部负责 adapter 分发、重试退避、
 * fallback 选择、取消传播、模型尝试审计与成本估算。
 * 边界：不直接依赖任何厂商 SDK；没有可用模型配置时抛出 ModelGatewayError 而非返回空结果。
 */
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

/** 已注册的模型服务商 adapter，通过 provider 名称索引。 */
const adapters = new Map<string, ModelProviderAdapter>([
  [openaiCompatibleAdapter.providerType, openaiCompatibleAdapter],
  [ollamaAdapter.providerType, ollamaAdapter],
  [deepseekAdapter.providerType, deepseekAdapter]
]);

/** 生成调用的可选配置：用途、fallback 模型、重试策略、默认超时、API Key 覆盖（测试用）与随机源。 */
export interface ModelGatewayOptions {
  purpose?: Extract<ModelPurpose, "writing" | "review" | "planning">;
  fallbackModels?: ModelConfigRecord[];
  retry?: AppConfig["models"]["retry"];
  defaultTimeoutMs?: number;
  apiKeyOverride?: string;
  random?: () => number;
}

/** 判断某个服务商是否已实现连接测试 adapter（未实现的配置可保存但无法测试）。 */
export function hasModelProviderAdapter(provider: string) {
  return adapters.has(provider);
}

/**
 * 列出某配置可用的模型名（用于前端下拉选择）。
 * @param apiKeyOverride 测试场景可临时传入密钥，优先于 secrets 文件
 * @throws 服务商未实现模型列表 adapter 时抛出错误
 */
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

/**
 * 带 fallback 与重试的模型文本生成主流程。
 * 策略：候选模型依次尝试，每个模型最多重试 maxAttemptsPerModel 次，全程不超过 maxTotalAttempts；
 * 可重试的错误（超时/限流/服务不可用等）才会退避重试，认证与请求无效直接抛出；
 * 每次尝试都会写入模型尝试审计，流式增量按窗口合并上报。
 * @throws ModelGatewayError：全部候选耗尽后抛出最后一个错误；无可用模型时抛出 invalid_request
 */
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

  // 流式输出按小窗口聚合后写入事件存储，避免每个 token 一条事件撑爆重放上限。
  let deltaBuffer = "";
  let deltaTimer: ReturnType<typeof setTimeout> | undefined;
  const flushDeltaBuffer = () => {
    if (deltaTimer) {
      clearTimeout(deltaTimer);
      deltaTimer = undefined;
    }
    if (!deltaBuffer || !activeContext) return;
    const delta = deltaBuffer;
    deltaBuffer = "";
    activeContext.eventStore.appendEvent(activeContext.runId, {
      type: "model_delta",
      stage: activeContext.stage,
      payload: { delta }
    });
  };
  // 每收到一段增量后重置 400ms 定时器，空闲后统一落盘，防止高频小片段频繁写事件
  const queueModelDelta = (chunk: string) => {
    deltaBuffer += chunk;
    if (!deltaTimer) deltaTimer = setTimeout(flushDeltaBuffer, 400);
  };

  // 生成进度心跳：流式期间每 10 秒上报一次等待时长，保证前端执行详情持续可见进展
  // （即使供应商长时间未返回首个增量，用户也能看到任务仍在进行）。
  let progressTimer: ReturnType<typeof setInterval> | undefined;
  const stopProgressHeartbeat = () => {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = undefined;
    }
  };
  if (activeContext && input.stream) {
    const startedWaiting = Date.now();
    progressTimer = setInterval(() => {
      try {
        activeContext.eventStore.appendEvent(activeContext.runId, {
          type: "stage_progress",
          stage: activeContext.stage,
          payload: { message: `模型生成中，已等待 ${Math.round((Date.now() - startedWaiting) / 1000)} 秒` }
        });
      } catch {
        // 运行已结束等异常场景：心跳写入失败直接忽略
      }
    }, 10_000);
    progressTimer.unref?.();
  }

  try {
    for (const model of candidates) {
    const adapter = adapters.get(model.provider);
    // 跳过停用模型与未实现文本生成的 adapter
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
        // 仅主模型且显式提供覆盖密钥时使用覆盖值，fallback 模型一律从 secrets 文件取
        const apiKey = model.id === primaryModel.id && options.apiKeyOverride
          ? options.apiKeyOverride
          : await getModelSecret(paths, model.id);
        const result = await adapter.generateText(model, apiKey, {
          ...input,
          timeoutMs,
          signal,
          onDelta: queueModelDelta
        });
        flushDeltaBuffer();
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
        // 失败时清空未落盘的流式缓冲，避免半截内容写入事件
        if (deltaTimer) {
          clearTimeout(deltaTimer);
          deltaTimer = undefined;
        }
        deltaBuffer = "";
        const normalized = normalizeModelGatewayError(error, signal);
        lastError = normalized;
        activeContext?.eventStore.finishModelAttempt(attempt!.id, {
          status: toAttemptStatus(normalized),
          latencyMs: Date.now() - startedAt,
          error: serializeModelGatewayError(normalized)
        });

        // 不可重试（认证/请求无效/已取消）直接终止整个流程
        if (!normalized.retryable) throw normalized;
        const hasAnotherAttemptForModel = modelAttempt < retry.maxAttemptsPerModel;
        const hasAttemptCapacity = totalAttempts < retry.maxTotalAttempts;
        if (hasAnotherAttemptForModel && hasAttemptCapacity) {
          try {
            // 退避期间同样受取消信号约束：用户中断时以取消错误终止，而不是继续发请求
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
  } finally {
    stopProgressHeartbeat();
  }
}

/**
 * 按优先级收集 fallback 模型：已路由模型 > 同用途模型 > 兼容用途的默认模型，
 * 均排除主模型本身并去重；保证即使用途元数据过期也有可用替补。
 */
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

/** 按 id 去重，保持首个出现的顺序。 */
function uniqueModels(models: ModelConfigRecord[]) {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

/** 把模型用途归一化为网关支持的三种用途，其余一律按写作处理（写作是最常见调用场景）。 */
function normalizePurpose(purpose: ModelPurpose): Extract<ModelPurpose, "writing" | "review" | "planning"> {
  return ["writing", "review", "planning"].includes(purpose)
    ? purpose as Extract<ModelPurpose, "writing" | "review" | "planning">
    : "writing";
}

/** 重试策略必须允许至少一次尝试，否则循环永远不会执行。 */
function assertRetryPolicy(retry: AppConfig["models"]["retry"]) {
  if (retry.maxAttemptsPerModel < 1 || retry.maxTotalAttempts < 1) {
    throw new Error("模型重试次数必须大于 0");
  }
}

/**
 * 指数退避：baseDelayMs * 2^(attempt-1)，叠加 0.8-1.2 的随机抖动避免多个请求同时重试（惊群）。
 */
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

/** 把网关错误类型映射为模型尝试审计状态。 */
function toAttemptStatus(error: ModelGatewayError) {
  if (error.kind === "cancelled") return "cancelled" as const;
  if (error.kind === "timeout") return "timed_out" as const;
  return "failed" as const;
}

/** 信号已中止时立即抛出取消错误，供重试循环在每次尝试前检查。 */
function throwIfCancelled(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new ModelGatewayError({ kind: "cancelled", retryable: false });
  }
}

/** 按配置的每百万 token 单价估算本次调用成本（微货币单位），缺少用量或定价数据时返回 null。 */
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

/** 校验并读取配置中的定价信息：币种必须是三位大写字母，单价必须为非负有限数值，否则视为无效定价。 */
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

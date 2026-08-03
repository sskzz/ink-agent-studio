/**
 * 文件职责：定义单次模型调用（attempt）的契约。
 * 记录一次完整模型调用的配置、token 消耗、耗时与结果，供前端展示成本/用量，
 * 后端据此做限流、降级与失败重试决策。
 */
import { z } from "zod";
import { isoDateTimeSchema, nonNegativeIntegerSchema } from "./common.js";

/** 单次模型调用记录：attemptNumber 从 1 递增，同一任务多次调用通过它区分轮次。 */
export const modelAttemptSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  stage: z.string().nullable(), // 发起调用的阶段，便于定位调用来源
  purpose: z.string().min(1), // 调用目的（规划/写作/审阅等），用于归因统计
  modelConfigId: z.string().nullable(),
  provider: z.string().nullable(), // 服务商，冗余存储以便离线分析
  model: z.string().nullable(), // 模型名
  attemptNumber: z.number().int().positive(), // 同任务内第几次尝试（重试递增）
  status: z.enum(["running", "completed", "failed", "cancelled", "timed_out"]),
  requestHash: z.string().nullable(), // 请求内容 hash，用于重试去重/幂等
  promptTokens: nonNegativeIntegerSchema.nullable(),
  completionTokens: nonNegativeIntegerSchema.nullable(),
  totalTokens: nonNegativeIntegerSchema.nullable(),
  estimatedCostMicros: nonNegativeIntegerSchema.nullable(), // 预估费用（微美元）
  costCurrency: z.string().regex(/^[A-Z]{3}$/).nullable(), // ISO 4217 三位货币代码
  latencyMs: nonNegativeIntegerSchema.nullable(),
  error: z.unknown().nullable(),
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.nullable()
}).strict();

export type ModelAttempt = z.infer<typeof modelAttemptSchema>;

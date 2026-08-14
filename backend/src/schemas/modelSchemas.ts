import { z } from "zod";

/**
 * 模型配置、路由与连接测试相关 Zod schema。
 */

/** 模型供应商标识枚举，决定模型网关使用的适配器。 */
export const modelProviderSchema = z.enum([
  "openai",
  "azure-openai",
  "openai-compatible",
  "anthropic",
  "ollama",
  "lmstudio",
  "vllm",
  "deepseek",
  "gemini",
  "qwen",
  "moonshot",
  "zhipu",
  "doubao",
  "baichuan",
  "baidu-qianfan",
  "tencent-hunyuan",
  "minimax",
  "mistral",
  "xai",
  "cohere",
  "openrouter",
  "oneapi",
  "litellm",
  "custom"
]);

/** 模型用途枚举，对应模型路由的三个槽位加辅助用途。 */
export const modelPurposeSchema = z.enum(["planning", "writing", "review", "embedding", "image"]);

/**
 * 计费信息结构：币种必须是三位大写 ISO 4217 代码。
 * 成本以百万 token 的微米计价，便于跨模型比较成本。
 */
const modelPricingSchema = z.object({
  currency: z.string().trim().regex(/^[A-Z]{3}$/, "币种必须是三位大写 ISO 4217 代码"),
  promptMicrosPerMillionTokens: z.number().int().nonnegative(),
  completionMicrosPerMillionTokens: z.number().int().nonnegative()
}).strict();

/**
 * 模型能力字典：任意键值对，但其中 pricing 必须满足 modelPricingSchema。
 * 用 superRefine 而非嵌套对象，是为了兼容旧数据中能力项的任意扩展。
 */
export const modelCapabilitiesSchema = z.object({
  contextWindow: z.number().int().min(4_096).optional(),
  maxOutputTokens: z.number().int().min(256).optional(),
  reasoningReserveTokens: z.number().int().nonnegative().optional(),
  supportsThinking: z.boolean().optional(),
  supportsJsonSchema: z.boolean().optional(),
  supportsStreaming: z.boolean().optional(),
  pricing: modelPricingSchema.optional()
}).catchall(z.unknown());

/**
 * 兼容旧字段别名：旧配置可能用 model 字段表示模型名，读取时统一回填为 apiModel。
 * 这样旧 JSON 无需迁移也能通过新 schema 校验。
 */
function withApiModelAlias(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  return {
    ...record,
    apiModel: typeof record.apiModel === "string" ? record.apiModel : record.model
  };
}

/**
 * 思考模式配置（DeepSeek V4）：enabled 控制思考模式开关，effort 控制推理强度。
 * effort 为 null 表示不发送该参数（使用服务商默认档位）。
 */
export const modelThinkingConfigSchema = z.object({
  enabled: z.boolean(),
  effort: z.enum(["low", "high", "max"]).nullable()
}).strict();

/** 模型配置记录结构（读取落盘 JSON 用），先经 withApiModelAlias 预处理。 */
const modelConfigRecordFieldsSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: modelProviderSchema,
  baseUrl: z.string(),
  apiModel: z.string(),
  purpose: modelPurposeSchema,
  enabled: z.boolean(),
  isDefault: z.boolean(),
  capabilities: modelCapabilitiesSchema,
  thinking: modelThinkingConfigSchema.nullable().default(null),
  note: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});
type ModelConfigRecordOutput = z.infer<typeof modelConfigRecordFieldsSchema>;

/** 模型配置记录（带 preprocess 的类型包装，导出给上层使用）。 */
export const modelConfigRecordSchema: z.ZodType<ModelConfigRecordOutput, z.ZodTypeDef, unknown> = z.preprocess(
  withApiModelAlias,
  modelConfigRecordFieldsSchema
);

/** 模型配置列表结构。 */
export const modelConfigsIndexSchema: z.ZodType<ModelConfigRecordOutput[], z.ZodTypeDef, unknown> =
  z.array(modelConfigRecordSchema);

/**
 * 模型配置新建/更新入参：apiKey 单独存放（secretStore），不写入记录本体。
 */
const modelConfigUpsertFieldsSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "配置名称不能为空"),
  provider: modelProviderSchema,
  baseUrl: z.string().trim().min(1, "Base URL 不能为空"),
  apiKey: z.string().optional().default(""),
  apiModel: z.string().trim().min(1, "API 调用模型不能为空"),
  purpose: modelPurposeSchema,
  enabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  capabilities: modelCapabilitiesSchema.optional(),
  thinking: modelThinkingConfigSchema.nullable().default(null),
  note: z.string().optional().default("")
});
type ModelConfigUpsertOutput = z.infer<typeof modelConfigUpsertFieldsSchema>;

/** 模型配置新建/更新入参（带 preprocess 的类型包装）。 */
export const modelConfigUpsertInputSchema: z.ZodType<ModelConfigUpsertOutput, z.ZodTypeDef, unknown> = z.preprocess(
  withApiModelAlias,
  modelConfigUpsertFieldsSchema
);

/** 模型路由映射结构：写作 / 审稿 / 规划三个槽位各绑定一个配置 id。 */
export const modelRoutesSchema = z.object({
  writingModelId: z.string().nullable(),
  reviewModelId: z.string().nullable(),
  planningModelId: z.string().nullable()
});

/** 路由槽位键。 */
export const modelRouteKeySchema = z.enum(["writing", "review", "planning"]);

/** 更新路由入参：modelConfigId 传 null 表示解绑该槽位。 */
export const modelRouteUpdateInputSchema = z.object({
  modelConfigId: z.string().nullable()
});

/**
 * 连接测试入参：基于 upsert 字段，但 id / apiKey / note 非必填，
 * 因为测试通常只关心 baseUrl + apiModel 是否可达。
 */
const modelConnectionTestFieldsSchema = modelConfigUpsertFieldsSchema.partial({
  id: true,
  apiKey: true,
  note: true
});
type ModelConnectionTestOutput = z.infer<typeof modelConnectionTestFieldsSchema>;

/** 连接测试入参（带 preprocess 的类型包装）。 */
export const modelConnectionTestInputSchema: z.ZodType<ModelConnectionTestOutput, z.ZodTypeDef, unknown> = z.preprocess(
  withApiModelAlias,
  modelConnectionTestFieldsSchema
);

/** 模型发现（列出远程可用模型）入参。 */
export const modelDiscoveryInputSchema = z.object({
  id: z.string().optional(),
  provider: modelProviderSchema,
  baseUrl: z.string().trim().min(1, "Base URL 不能为空"),
  apiKey: z.string().optional().default("")
});

export type ModelConfigRecordSchema = z.infer<typeof modelConfigRecordSchema>;
export type ModelConfigUpsertInput = z.infer<typeof modelConfigUpsertInputSchema>;
export type ModelRoutesSchema = z.infer<typeof modelRoutesSchema>;
export type ModelRouteKey = z.infer<typeof modelRouteKeySchema>;
export type ModelConnectionTestInput = z.infer<typeof modelConnectionTestInputSchema>;
export type ModelDiscoveryInput = z.infer<typeof modelDiscoveryInputSchema>;

import { z } from "zod";

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

export const modelPurposeSchema = z.enum(["planning", "writing", "review", "embedding", "image"]);

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

const modelConfigRecordFieldsSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: modelProviderSchema,
  baseUrl: z.string(),
  apiModel: z.string(),
  purpose: modelPurposeSchema,
  enabled: z.boolean(),
  isDefault: z.boolean(),
  capabilities: z.record(z.unknown()),
  note: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});
type ModelConfigRecordOutput = z.infer<typeof modelConfigRecordFieldsSchema>;

export const modelConfigRecordSchema: z.ZodType<ModelConfigRecordOutput, z.ZodTypeDef, unknown> = z.preprocess(
  withApiModelAlias,
  modelConfigRecordFieldsSchema
);

export const modelConfigsIndexSchema: z.ZodType<ModelConfigRecordOutput[], z.ZodTypeDef, unknown> =
  z.array(modelConfigRecordSchema);

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
  note: z.string().optional().default("")
});
type ModelConfigUpsertOutput = z.infer<typeof modelConfigUpsertFieldsSchema>;

export const modelConfigUpsertInputSchema: z.ZodType<ModelConfigUpsertOutput, z.ZodTypeDef, unknown> = z.preprocess(
  withApiModelAlias,
  modelConfigUpsertFieldsSchema
);

export const modelRoutesSchema = z.object({
  writingModelId: z.string().nullable(),
  reviewModelId: z.string().nullable(),
  planningModelId: z.string().nullable()
});

export const modelRouteKeySchema = z.enum(["writing", "review", "planning"]);

export const modelRouteUpdateInputSchema = z.object({
  modelConfigId: z.string().nullable()
});

const modelConnectionTestFieldsSchema = modelConfigUpsertFieldsSchema.partial({
  id: true,
  apiKey: true,
  note: true
});
type ModelConnectionTestOutput = z.infer<typeof modelConnectionTestFieldsSchema>;

export const modelConnectionTestInputSchema: z.ZodType<ModelConnectionTestOutput, z.ZodTypeDef, unknown> = z.preprocess(
  withApiModelAlias,
  modelConnectionTestFieldsSchema
);

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

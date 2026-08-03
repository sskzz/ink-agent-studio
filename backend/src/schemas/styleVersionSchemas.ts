import { z } from "zod";
import { writingStyleAnalysisSchema, writingStyleFeatureProfileSchema } from "./styleSchemas.js";

/**
 * 写作风格不可变版本（v2 体系）相关 Zod schema。
 * 版本由多个样本聚合而成，一次生成、之后不可变，作品通过 writingStyleVersionId 固定引用。
 */

/** 场景类型枚举：续写时决定使用哪组场景规则。 */
export const sceneTypeSchema = z.enum([
  "action",
  "dialogue",
  "introspection",
  "description",
  "suspense",
  "climax",
  "transition",
  "daily",
  "mixed"
]);

/** 样本质量评估：usable 决定是否参与聚合，weight 控制加权权重。 */
export const styleSampleQualitySchema = z.object({
  usable: z.boolean(),
  weight: z.number().min(0).max(1),
  detectedContentType: z.enum(["narrative", "script", "essay", "outline", "metadata", "unknown"]),
  warnings: z.array(z.string())
});

/** 风格样本记录：保存特征画像与质量评估，供聚合生成版本。 */
export const writingStyleSampleSchema = z.object({
  id: z.string(),
  styleId: z.string(),
  fileName: z.string(),
  contentPath: z.string(),
  contentHash: z.string(),
  contentLength: z.number().int().nonnegative(),
  featureVersion: z.string(),
  featureProfile: writingStyleFeatureProfileSchema,
  quality: styleSampleQualitySchema,
  createdAt: z.string(),
  updatedAt: z.string()
});

/** 单指标的跨样本聚合统计（加权均值 / 中位数 / 稳定性等）。 */
export const aggregateMetricSchema = z.object({
  metric: z.string(),
  weightedMean: z.number(),
  median: z.number(),
  standardDeviation: z.number(),
  mad: z.number(),
  preferredMin: z.number(),
  preferredMax: z.number(),
  stability: z.number().min(0).max(1),
  validSampleCount: z.number().int().nonnegative(),
  outlierSampleIds: z.array(z.string())
});

/** 聚合风格画像：置信度与状态决定该版本能否被作品使用。 */
export const aggregateStyleProfileSchema = z.object({
  schemaVersion: z.literal("style-aggregate.v1"),
  sampleCount: z.number().int().nonnegative(),
  validSampleCount: z.number().int().nonnegative(),
  totalContentLength: z.number().int().nonnegative(),
  confidence: z.number().int().min(0).max(100),
  status: z.enum(["degraded", "usable", "stable"]),
  metrics: z.record(aggregateMetricSchema),
  acceptedSampleIds: z.array(z.string()).optional().default([]),
  weakSampleIds: z.array(z.string()).optional().default([]),
  rejectedSampleIds: z.array(z.string()).optional().default([]),
  warnings: z.array(z.string())
});

/** 语义风格规则（v4）：不变规则必须逐字保留，灵活规则允许在风格边界内变化。 */
const semanticStyleRuleSchema = z.object({
  id: z.string(),
  rule: z.string(),
  reason: z.string(),
  priority: z.number().int().min(1).max(5)
});

/**
 * 语义风格画像（v4）：按场景组织规则，含不变/灵活规则、反 AI 味规则与样本一致性评分。
 */
export const semanticStyleProfileV4Schema = z.object({
  schemaVersion: z.literal("style-analysis.v4"),
  summary: z.string(),
  stylePromptSnippet: z.string(),
  reviewPromptSnippet: z.string(),
  invariantRules: z.array(semanticStyleRuleSchema),
  flexibleRules: z.array(semanticStyleRuleSchema),
  sceneRules: z.array(z.object({ sceneType: sceneTypeSchema, rules: z.array(z.string()) })),
  antiAiRules: z.array(z.object({
    id: z.string(),
    canonicalKey: z.string().optional(),
    mode: z.enum(["tighten", "relax", "supplement"]).optional(),
    rule: z.string(),
    detectHint: z.string(),
    rewriteHint: z.string(),
    severity: z.enum(["low", "medium", "high"])
  })),
  mustKeep: z.array(z.string()),
  canVary: z.array(z.string()),
  sampleAgreement: z.object({
    agreementScore: z.number().int().min(0).max(100),
    conflicts: z.array(z.string())
  }),
  confidence: z.number().int().min(0).max(100),
  warnings: z.array(z.string())
});

/** 风格约束策略：决定机器自动修订的次数上限与哪些规则不可被修订。 */
export const styleConstraintPolicySchema = z.object({
  strongMetricStability: z.number().min(0).max(1),
  softMetricStability: z.number().min(0).max(1),
  maxAutomaticRevisions: z.number().int().min(0).max(2),
  invariantRuleIds: z.array(z.string())
});

/**
 * 不可变风格版本：记录样本、聚合画像、语义画像与约束策略，
 * styleHash 用于检测外部修改并保证同一版本约束内容一致。
 */
export const writingStyleVersionSchema = z.object({
  id: z.string(),
  styleId: z.string(),
  schemaVersion: z.literal("writing-style-version.v1"),
  analysisVersion: z.string(),
  featureVersion: z.string(),
  aggregationVersion: z.string(),
  compilerVersion: z.string(),
  sampleIds: z.array(z.string()),
  sampleHashes: z.array(z.string()),
  aggregateProfile: aggregateStyleProfileSchema,
  semanticProfile: z.union([semanticStyleProfileV4Schema, writingStyleAnalysisSchema]),
  constraintPolicy: styleConstraintPolicySchema,
  styleHash: z.string(),
  createdAt: z.string()
});

/** 样本列表索引结构。 */
export const styleSamplesIndexSchema = z.array(writingStyleSampleSchema);
/** 版本列表摘要结构（不含完整画像，用于列表页）。 */
export const styleVersionsIndexSchema = z.array(z.object({
  id: z.string(),
  styleId: z.string(),
  styleHash: z.string(),
  sampleCount: z.number().int().nonnegative(),
  confidence: z.number().int().min(0).max(100),
  status: z.enum(["degraded", "usable", "stable"]),
  createdAt: z.string()
}));

/** 添加样本入参：fileName + content 必填，服务端解析正文并生成特征画像。 */
export const styleSampleCreateInputSchema = z.object({
  fileName: z.string().trim().min(1),
  content: z.string().min(1)
});

export type SceneType = z.infer<typeof sceneTypeSchema>;
export type WritingStyleSample = z.infer<typeof writingStyleSampleSchema>;
export type AggregateStyleProfile = z.infer<typeof aggregateStyleProfileSchema>;
export type SemanticStyleProfileV4 = z.infer<typeof semanticStyleProfileV4Schema>;
export type WritingStyleVersion = z.infer<typeof writingStyleVersionSchema>;

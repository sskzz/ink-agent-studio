import { z } from "zod";

/**
 * 写作风格分析（v3）与风格记录相关 Zod schema。
 */

/** 可执行风格规则：rule 为机器可执行约束，priority 越低越优先。 */
const styleRuleSchema = z.object({
  rule: z.string(),
  reason: z.string(),
  priority: z.number().int().min(1).max(5)
});

/** 分析证据片段：截取原文短片段佐证特征，snippet 限 18 字。 */
const styleEvidenceSchema = z.object({
  feature: z.string(),
  reason: z.string(),
  snippet: z.string().max(18)
});

/** 反 AI 味规则：forbidden/risk/encourage 三类，机器校验时按 severity 决定是否阻断。 */
const antiAiRuleSchema = z.object({
  type: z.enum(["forbidden", "risk", "encourage"]),
  category: z.enum(["emotion", "dialogue", "description", "structure", "language", "logic", "rhythm"]),
  canonicalKey: z.string().optional(),
  mode: z.enum(["tighten", "relax", "supplement"]).optional(),
  rule: z.string(),
  detectHint: z.string(),
  rewriteHint: z.string(),
  severity: z.enum(["low", "medium", "high"])
});

/** 风格特征画像：样本的量化指标（句长、段落等），用于跨版本对比稳定性。 */
export const writingStyleFeatureProfileSchema = z.object({
  schemaVersion: z.literal("style-features.v1"),
  sourceContentLength: z.number().int().nonnegative(),
  metrics: z.record(z.number().finite())
});

/**
 * 写作风格完整分析（v3）：
 * 含 13 项风格参数、主次风格、可执行规则、反 AI 味画像与风格边界，
 * 由规划模型对模板作品样本生成。
 */
export const writingStyleAnalysisSchema = z.object({
  schemaVersion: z.literal("style-analysis.v3"),
  summary: z.string(),
  voiceProfile: z.string(),
  structureRule: z.string(),
  aiReductionRule: z.string(),
  stylePromptSnippet: z.string(),
  reviewPromptSnippet: z.string(),
  parameters: z.object({
    tone: z.string(),
    register: z.string(),
    pointOfView: z.string(),
    cameraDistance: z.string(),
    sentencePattern: z.string(),
    paragraphPattern: z.string(),
    dialogueStyle: z.string(),
    descriptionFocus: z.string(),
    emotionStyle: z.string(),
    narrativeDrive: z.string(),
    pacing: z.string(),
    sceneSuitability: z.string(),
    aiReduction: z.string(),
    confidence: z.number().int().min(0).max(100)
  }),
  dominantStyle: z.object({
    name: z.string(),
    description: z.string(),
    strength: z.number().int().min(0).max(100)
  }),
  secondaryStyles: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        strength: z.number().int().min(0).max(100)
      })
    )
    .max(4),
  executableRules: z.object({
    narrativeRules: z.array(styleRuleSchema).min(1).max(5),
    languageRules: z.array(styleRuleSchema).min(1).max(5),
    rhythmRules: z.array(styleRuleSchema).min(1).max(5),
    dialogueRules: z.array(styleRuleSchema).min(1).max(5),
    descriptionRules: z.array(styleRuleSchema).min(1).max(5),
    emotionRules: z.array(styleRuleSchema).min(1).max(5)
  }),
  antiAiProfile: z.object({
    riskLevel: z.enum(["low", "medium", "high"]),
    mainRisks: z.array(z.string()).max(6),
    naturalnessPrinciple: z.string()
  }),
  antiAiRules: z.array(antiAiRuleSchema).min(4).max(10),
  styleBoundaries: z.object({
    bestFor: z.array(z.string()).max(6),
    avoidFor: z.array(z.string()).max(6),
    mustKeep: z.array(z.string()).max(6),
    canVary: z.array(z.string()).max(6)
  }),
  evidence: z.array(styleEvidenceSchema).max(8),
  warnings: z.array(z.string()).max(6)
});

/**
 * 风格记录结构：id 为索引主键，analysis/featureProfile 在分析完成后填充，
 * latestVersionId 指向当前生效的不可变版本。
 */
export const writingStyleRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string(),
  parameters: z.record(z.unknown()),
  sampleFileName: z.string().nullable(),
  analysis: writingStyleAnalysisSchema.optional(),
  featureProfile: writingStyleFeatureProfileSchema.optional(),
  latestVersionId: z.string().nullable().optional(),
  sampleCount: z.number().int().nonnegative().optional(),
  validSampleCount: z.number().int().nonnegative().optional(),
  status: z.enum(["draft", "analyzing", "ready", "degraded", "invalid"]).optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

/** 风格列表索引结构。 */
export const writingStylesIndexSchema = z.array(writingStyleRecordSchema);

/** 新建风格入参：name 必填，可直接携带 analysis/featureProfile 跳过分析。 */
export const writingStyleCreateInputSchema = z.object({
  name: z.string().trim().min(1, "风格名称不能为空"),
  summary: z.string().optional().default(""),
  parameters: z.record(z.unknown()).optional().default({}),
  sampleFileName: z.string().nullable().optional().default(null),
  analysis: writingStyleAnalysisSchema.optional(),
  featureProfile: writingStyleFeatureProfileSchema.optional()
});

/** 风格分析请求入参：content 为模板作品样本正文，必填。 */
export const styleAnalyzeInputSchema = z.object({
  name: z.string().trim().optional().default("AI 分析风格"),
  sampleFileName: z.string().trim().optional().default("sample.md"),
  content: z.string().min(1, "模板作品内容不能为空")
});

export type WritingStyleAnalysis = z.infer<typeof writingStyleAnalysisSchema>;
export type WritingStyleFeatureProfile = z.infer<typeof writingStyleFeatureProfileSchema>;

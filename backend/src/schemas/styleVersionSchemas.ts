import { z } from "zod";
import { writingStyleAnalysisSchema, writingStyleFeatureProfileSchema } from "./styleSchemas.js";

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

export const styleSampleQualitySchema = z.object({
  usable: z.boolean(),
  weight: z.number().min(0).max(1),
  detectedContentType: z.enum(["narrative", "script", "essay", "outline", "metadata", "unknown"]),
  warnings: z.array(z.string())
});

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

const semanticStyleRuleSchema = z.object({
  id: z.string(),
  rule: z.string(),
  reason: z.string(),
  priority: z.number().int().min(1).max(5)
});

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

export const styleConstraintPolicySchema = z.object({
  strongMetricStability: z.number().min(0).max(1),
  softMetricStability: z.number().min(0).max(1),
  maxAutomaticRevisions: z.number().int().min(0).max(2),
  invariantRuleIds: z.array(z.string())
});

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

export const styleSamplesIndexSchema = z.array(writingStyleSampleSchema);
export const styleVersionsIndexSchema = z.array(z.object({
  id: z.string(),
  styleId: z.string(),
  styleHash: z.string(),
  sampleCount: z.number().int().nonnegative(),
  confidence: z.number().int().min(0).max(100),
  status: z.enum(["degraded", "usable", "stable"]),
  createdAt: z.string()
}));

export const styleSampleCreateInputSchema = z.object({
  fileName: z.string().trim().min(1),
  content: z.string().min(1)
});

export type SceneType = z.infer<typeof sceneTypeSchema>;
export type WritingStyleSample = z.infer<typeof writingStyleSampleSchema>;
export type AggregateStyleProfile = z.infer<typeof aggregateStyleProfileSchema>;
export type SemanticStyleProfileV4 = z.infer<typeof semanticStyleProfileV4Schema>;
export type WritingStyleVersion = z.infer<typeof writingStyleVersionSchema>;

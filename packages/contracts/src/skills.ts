import { z } from "zod";
import { isoDateTimeSchema } from "./common.js";

export const novelSkillOperationSchema = z.enum(["planning", "writing", "review"]);
export const novelSkillSourceSchema = z.enum(["builtin", "custom"]);

export const novelSkillMetadataSchema = z.object({
  schemaVersion: z.literal("novel-skill.v1"),
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  version: z.number().int().positive(),
  source: novelSkillSourceSchema,
  enabled: z.boolean(),
  appliesTo: z.array(novelSkillOperationSchema).min(1),
  triggerTerms: z.array(z.string().trim().min(1).max(80)).max(50),
  priority: z.number().int().min(1).max(100),
  instructionHash: z.string().regex(/^[a-f0-9]{64}$/),
  instructionEstimatedTokens: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
}).strict();

export const novelSkillDetailSchema = z.object({
  metadata: novelSkillMetadataSchema,
  instructions: z.string().min(1).max(100_000)
}).strict();

export const novelSkillPreviewInputSchema = z.object({
  operation: novelSkillOperationSchema,
  instruction: z.string().max(100_000).default(""),
  context: z.string().max(100_000).default(""),
  requestedSkillIds: z.array(z.string()).max(20).default([])
}).strict();

export const novelSkillSelectionItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  score: z.number(),
  explicit: z.boolean(),
  matchedTerms: z.array(z.string()),
  includedEstimatedTokens: z.number().int().nonnegative(),
  truncated: z.boolean(),
  instructionHash: z.string()
}).strict();

export const novelSkillSelectionSchema = z.object({
  prompt: z.string(),
  trace: z.object({
    schemaVersion: z.literal("skill-selection-trace.v1"),
    operation: novelSkillOperationSchema,
    metadataScanned: z.number().int().nonnegative(),
    maxLoadedSkills: z.number().int().positive(),
    promptTokenBudget: z.number().int().positive(),
    totalEstimatedTokens: z.number().int().nonnegative(),
    selected: z.array(novelSkillSelectionItemSchema),
    skipped: z.array(z.object({ id: z.string(), reason: z.string() }).strict()),
    degradedReasons: z.array(z.string())
  }).strict()
}).strict();

export const novelSkillCreateInputSchema = z.object({
  approved: z.literal(true),
  id: novelSkillMetadataSchema.shape.id,
  name: novelSkillMetadataSchema.shape.name,
  description: novelSkillMetadataSchema.shape.description,
  appliesTo: novelSkillMetadataSchema.shape.appliesTo,
  triggerTerms: novelSkillMetadataSchema.shape.triggerTerms,
  priority: novelSkillMetadataSchema.shape.priority.default(50),
  instructions: z.string().trim().min(1).max(100_000)
}).strict();

export const novelSkillStatusInputSchema = z.object({
  enabled: z.boolean(),
  approved: z.literal(true)
}).strict();

export type NovelSkillOperation = z.infer<typeof novelSkillOperationSchema>;
export type NovelSkillMetadata = z.infer<typeof novelSkillMetadataSchema>;
export type NovelSkillDetail = z.infer<typeof novelSkillDetailSchema>;
export type NovelSkillPreviewInput = z.infer<typeof novelSkillPreviewInputSchema>;
export type NovelSkillSelection = z.infer<typeof novelSkillSelectionSchema>;
export type NovelSkillCreateInput = z.infer<typeof novelSkillCreateInputSchema>;

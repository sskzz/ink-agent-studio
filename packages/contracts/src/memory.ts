import { z } from "zod";
import { isoDateTimeSchema } from "./common.js";

export const userPreferenceCategorySchema = z.enum(["writing", "review", "workflow", "formatting"]);
export const userPreferenceKeySchema = z.enum([
  "narrative_pacing",
  "paragraph_length",
  "dialogue_density",
  "description_density",
  "emotion_expression",
  "banned_expressions",
  "review_strictness",
  "revision_scope",
  "output_format",
  "interaction_style"
]);
export const userPreferenceStatusSchema = z.enum(["proposed", "active", "rejected", "archived"]);

export const userPreferenceSchema = z.object({
  schemaVersion: z.literal("user-preference.v1"),
  id: z.string().min(1),
  category: userPreferenceCategorySchema,
  key: userPreferenceKeySchema,
  value: z.string().trim().min(1).max(500),
  reason: z.string().trim().min(1).max(500),
  rejectionReason: z.string().trim().min(1).max(500).nullable(),
  status: userPreferenceStatusSchema,
  priority: z.number().int().min(1).max(100),
  tokenEstimate: z.number().int().positive(),
  sourceSessionId: z.string().nullable(),
  sourceMessageId: z.string().nullable(),
  replacesPreferenceId: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  approvedAt: isoDateTimeSchema.nullable(),
  rejectedAt: isoDateTimeSchema.nullable(),
  archivedAt: isoDateTimeSchema.nullable()
}).strict();

export const userPreferenceProposalInputSchema = z.object({
  category: userPreferenceCategorySchema,
  key: userPreferenceKeySchema,
  value: userPreferenceSchema.shape.value,
  reason: userPreferenceSchema.shape.reason,
  priority: userPreferenceSchema.shape.priority.default(50),
  sourceSessionId: z.string().min(1).nullable().default(null),
  sourceMessageId: z.string().min(1).nullable().default(null)
}).strict().superRefine((input, context) => {
  if (input.sourceMessageId && !input.sourceSessionId) {
    context.addIssue({
      code: "custom",
      path: ["sourceSessionId"],
      message: "关联来源消息时必须同时提供来源 Session"
    });
  }
});

export const userPreferenceApprovalInputSchema = z.object({ approved: z.literal(true) }).strict();
export const userPreferenceRejectionInputSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
export const userPreferenceArchiveInputSchema = z.object({ approved: z.literal(true) }).strict();

export const userMemorySelectionSchema = z.object({
  prompt: z.string(),
  trace: z.object({
    schemaVersion: z.literal("user-memory-trace.v1"),
    enabled: z.boolean(),
    activeScanned: z.number().int().nonnegative(),
    promptTokenBudget: z.number().int().positive(),
    totalEstimatedTokens: z.number().int().nonnegative(),
    selectedIds: z.array(z.string()),
    truncatedIds: z.array(z.string())
  }).strict()
}).strict();

export type UserPreference = z.infer<typeof userPreferenceSchema>;
export type UserPreferenceProposalInput = z.infer<typeof userPreferenceProposalInputSchema>;
export type UserMemorySelection = z.infer<typeof userMemorySelectionSchema>;

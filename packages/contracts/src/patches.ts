import { z } from "zod";
import { isoDateTimeSchema } from "./common.js";

export const statePatchTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("book_file"), fileId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("chapter"), chapterId: z.string().min(1) }).strict()
]);

export const statePatchStatusSchema = z.enum([
  "proposed",
  "applying",
  "applied",
  "rejected",
  "conflicted",
  "failed"
]);

export const statePatchProposalInputSchema = z.object({
  bookId: z.string().min(1),
  target: statePatchTargetSchema,
  proposedContent: z.string(),
  reason: z.string().min(1)
}).strict();

export const statePatchSchema = z.object({
  schemaVersion: z.literal("state-patch.v1"),
  id: z.string().min(1),
  runId: z.string().min(1),
  bookId: z.string().min(1),
  target: statePatchTargetSchema,
  status: statePatchStatusSchema,
  reason: z.string().min(1),
  baseHash: z.string().min(1),
  proposedHash: z.string().min(1),
  proposedContent: z.string(),
  backupFile: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  appliedAt: isoDateTimeSchema.nullable(),
  rejectedAt: isoDateTimeSchema.nullable()
}).strict();

export const statePatchApplyInputSchema = z.object({
  approved: z.literal(true),
  expectedBaseHash: z.string().min(1)
}).strict();

export const statePatchRejectInputSchema = z.object({
  reason: z.string().trim().min(1).default("用户拒绝")
}).strict();

export type StatePatchTarget = z.infer<typeof statePatchTargetSchema>;
export type StatePatchStatus = z.infer<typeof statePatchStatusSchema>;
export type StatePatchProposalInput = z.infer<typeof statePatchProposalInputSchema>;
export type StatePatch = z.infer<typeof statePatchSchema>;

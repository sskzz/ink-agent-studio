import { z } from "zod";
import { isoDateTimeSchema, nonNegativeIntegerSchema } from "./common.js";

export const modelAttemptSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  stage: z.string().nullable(),
  purpose: z.string().min(1),
  modelConfigId: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  attemptNumber: z.number().int().positive(),
  status: z.enum(["running", "completed", "failed", "cancelled", "timed_out"]),
  requestHash: z.string().nullable(),
  promptTokens: nonNegativeIntegerSchema.nullable(),
  completionTokens: nonNegativeIntegerSchema.nullable(),
  totalTokens: nonNegativeIntegerSchema.nullable(),
  estimatedCostMicros: nonNegativeIntegerSchema.nullable(),
  costCurrency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  latencyMs: nonNegativeIntegerSchema.nullable(),
  error: z.unknown().nullable(),
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.nullable()
}).strict();

export type ModelAttempt = z.infer<typeof modelAttemptSchema>;

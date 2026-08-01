import { z } from "zod";
import { isoDateTimeSchema, nonNegativeIntegerSchema } from "./common.js";

export const runEventTypeSchema = z.enum([
  "run_created",
  "run_queued",
  "run_started",
  "stage_started",
  "stage_progress",
  "stage_completed",
  "model_attempt_started",
  "model_delta",
  "model_attempt_completed",
  "tool_started",
  "tool_completed",
  "review_completed",
  "degraded",
  "checkpoint_saved",
  "cancel_requested",
  "run_cancelled",
  "run_completed",
  "run_failed",
  "run_interrupted"
]);

export const runEventSchema = z.object({
  schemaVersion: z.literal("run-event.v1"),
  runId: z.string().min(1),
  seq: nonNegativeIntegerSchema,
  eventId: z.string().min(1),
  type: runEventTypeSchema,
  stage: z.string().nullable(),
  timestamp: isoDateTimeSchema,
  payload: z.record(z.unknown()),
  artifactRefs: z.array(z.string()).default([])
}).strict();

export type RunEventType = z.infer<typeof runEventTypeSchema>;
export type RunEvent = z.infer<typeof runEventSchema>;

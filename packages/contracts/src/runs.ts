import { z } from "zod";
import { isoDateTimeSchema, nonNegativeIntegerSchema } from "./common.js";

export const runStatusSchema = z.enum([
  "queued",
  "running",
  "cancelling",
  "cancelled",
  "completed",
  "failed",
  "interrupted"
]);

const chapterCommandInputSchema = z.object({
  instruction: z.string().default(""),
  selectedContextFileIds: z.array(z.string()).default([]),
  sceneType: z.string().default("auto"),
  allowDegradedStyle: z.boolean().default(false)
}).strict();

export const runCommandSchema = z.discriminatedUnion("type", [
  z.object({
    schemaVersion: z.literal("run-command.v1"),
    type: z.literal("continue_chapter"),
    bookId: z.string().min(1),
    chapterId: z.string().min(1),
    input: chapterCommandInputSchema
  }).strict(),
  z.object({
    schemaVersion: z.literal("run-command.v1"),
    type: z.literal("review_chapter"),
    bookId: z.string().min(1),
    chapterId: z.string().min(1),
    input: chapterCommandInputSchema
  }).strict(),
  z.object({
    schemaVersion: z.literal("run-command.v1"),
    type: z.literal("polish_chapter"),
    bookId: z.string().min(1),
    chapterId: z.string().min(1),
    input: chapterCommandInputSchema
  }).strict(),
  z.object({
    schemaVersion: z.literal("run-command.v1"),
    type: z.literal("initialize_book"),
    bookId: z.string().min(1),
    input: z.record(z.unknown())
  }).strict(),
  z.object({
    schemaVersion: z.literal("run-command.v1"),
    type: z.literal("consistency_check"),
    bookId: z.string().min(1),
    input: chapterCommandInputSchema
  }).strict()
]);

/**
 * 旧版 JSONL 运行记录只用于迁移和追溯，不能由新的 Run 创建接口提交。
 * 将它与可执行 RunCommand 分开，可避免历史数据绕过当前命令校验。
 */
export const legacyRunCommandSchema = z.object({
  schemaVersion: z.literal("legacy-run-command.v1"),
  type: z.literal("legacy_import"),
  legacyRunType: z.string().min(1),
  bookId: z.string().nullable(),
  input: z.unknown()
}).strict();

export const persistedRunCommandSchema = z.union([runCommandSchema, legacyRunCommandSchema]);

export const runCreateRequestSchema = z.object({
  command: runCommandSchema,
  parentRunId: z.string().min(1).nullable().default(null),
  sessionId: z.string().min(1).nullable().default(null),
  triggerMessageId: z.string().min(1).nullable().default(null)
}).strict();

export const runSnapshotSchema = z.object({
  schemaVersion: z.literal("run-snapshot.v1"),
  id: z.string().min(1),
  command: persistedRunCommandSchema,
  bookId: z.string().nullable(),
  chapterId: z.string().nullable(),
  parentRunId: z.string().nullable(),
  rootRunId: z.string().min(1),
  sessionId: z.string().nullable(),
  triggerMessageId: z.string().nullable(),
  status: runStatusSchema,
  currentStage: z.string().nullable(),
  configRevision: z.number().int().positive().nullable(),
  configHash: z.string().min(1).nullable(),
  output: z.unknown().nullable(),
  error: z.unknown().nullable(),
  cancelRequestedAt: isoDateTimeSchema.nullable(),
  lastEventSeq: nonNegativeIntegerSchema,
  createdAt: isoDateTimeSchema,
  queuedAt: isoDateTimeSchema.nullable(),
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
  updatedAt: isoDateTimeSchema
}).strict();

export const runAcceptedSchema = z.object({
  runId: z.string().min(1),
  status: z.literal("queued"),
  eventsUrl: z.string().min(1),
  acceptedAt: isoDateTimeSchema
}).strict();

export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunCommand = z.infer<typeof runCommandSchema>;
export type LegacyRunCommand = z.infer<typeof legacyRunCommandSchema>;
export type PersistedRunCommand = z.infer<typeof persistedRunCommandSchema>;
export type RunCreateRequest = z.infer<typeof runCreateRequestSchema>;
export type RunSnapshot = z.infer<typeof runSnapshotSchema>;
export type RunAccepted = z.infer<typeof runAcceptedSchema>;

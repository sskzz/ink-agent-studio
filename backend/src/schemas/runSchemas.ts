import { z } from "zod";

export const agentRunStatusSchema = z.enum(["queued", "running", "completed", "failed", "cancelled"]);

export const agentRunRecordSchema = z.object({
  id: z.string(),
  bookId: z.string().nullable(),
  runType: z.string(),
  status: agentRunStatusSchema,
  inputJson: z.unknown(),
  outputJson: z.unknown().nullable(),
  modelConfigId: z.string().nullable(),
  promptVersion: z.string().nullable(),
  tokenUsageJson: z.unknown().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable()
});

export type AgentRunRecordSchema = z.infer<typeof agentRunRecordSchema>;

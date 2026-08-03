import { z } from "zod";

/**
 * Agent 运行（Run）记录相关 Zod schema。
 */

/** Run 状态枚举（与运行数据库 runs.status 一致）。 */
export const agentRunStatusSchema = z.enum(["queued", "running", "completed", "failed", "cancelled"]);

/**
 * Run 记录结构（JSONL 追加日志行）。
 * inputJson/outputJson/tokenUsage 等为透传 JSON，仅保证整体为合法 JSON。
 */
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
  styleTraceJson: z.unknown().nullable().optional().default(null),
  errorMessage: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable()
});

/** Run 列表索引结构。 */
export type AgentRunRecordSchema = z.infer<typeof agentRunRecordSchema>;

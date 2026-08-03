/**
 * 文件职责：定义会话（Session）与消息契约，支撑聊天界面、上下文重建与搜索。
 * 前后端共享：后端持久化消息并计算 contentHash，前端提交创建/搜索输入。
 */
import { z } from "zod";
import { isoDateTimeSchema } from "./common.js";

/** 会话状态：active 正常使用，archived 归档后不再出现在活跃列表。 */
export const sessionStatusSchema = z.enum(["active", "archived"]);
/** 消息角色：与主流模型消息约定一致，tool 为工具调用结果。 */
export const sessionMessageRoleSchema = z.enum(["system", "user", "assistant", "tool"]);

/** 会话记录：按书归属（bookId 可为 null 表示全局会话），支持父子会话树。 */
export const sessionSchema = z.object({
  schemaVersion: z.literal("session.v1"),
  id: z.string().min(1),
  bookId: z.string().nullable(),
  title: z.string(),
  status: sessionStatusSchema,
  parentSessionId: z.string().nullable(), // 父子会话形成分支，用于话题分叉
  lastMessageAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
}).strict();

/** 单条消息：contentHash 用于去重与变更检测，tokenEstimate 用于上下文预算。 */
export const sessionMessageSchema = z.object({
  schemaVersion: z.literal("session-message.v1"),
  id: z.string().min(1),
  sessionId: z.string().min(1),
  bookId: z.string().nullable(),
  parentMessageId: z.string().nullable(), // 引用前一条消息，构成消息链
  role: sessionMessageRoleSchema,
  content: z.string(),
  contentHash: z.string().min(1), // 内容 hash，便于识别重复/漂移内容
  tokenEstimate: z.number().int().nonnegative(), // 预估 token 数，供上下文裁剪决策
  metadata: z.record(z.unknown()),
  createdAt: isoDateTimeSchema
}).strict();

/** 创建会话的输入：标题允许为空（自动生成），可指定父会话形成分支。 */
export const sessionCreateInputSchema = z.object({
  bookId: z.string().min(1).nullable().default(null),
  title: z.string().trim().max(200).default(""),
  parentSessionId: z.string().min(1).nullable().default(null)
}).strict();

/** 追加消息的输入：单条上限 100 万字符，防止超大消息拖垮上下文。 */
export const sessionMessageCreateInputSchema = z.object({
  role: sessionMessageRoleSchema,
  content: z.string().max(1_000_000),
  parentMessageId: z.string().min(1).nullable().default(null),
  metadata: z.record(z.unknown()).default({})
}).strict();

/** 会话搜索输入：关键词必填，可按会话/书过滤，limit 上限 200 条。 */
export const sessionSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  sessionId: z.string().min(1).optional(),
  bookId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional()
}).strict();

/** 搜索结果条目：携带命中的消息与高亮片段，rank 为相关性排序值。 */
export const sessionSearchResultSchema = z.object({
  message: sessionMessageSchema,
  snippet: z.string(),
  rank: z.number().nullable()
}).strict();

export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type SessionMessage = z.infer<typeof sessionMessageSchema>;
export type SessionCreateInput = z.infer<typeof sessionCreateInputSchema>;
export type SessionMessageCreateInput = z.infer<typeof sessionMessageCreateInputSchema>;
export type SessionSearchInput = z.infer<typeof sessionSearchInputSchema>;
export type SessionSearchResult = z.infer<typeof sessionSearchResultSchema>;

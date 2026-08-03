/**
 * 文件职责：定义「状态补丁（state patch）」相关契约。
 * 补丁是 Agent 对书稿等状态的最小可审批修改单元，前后端共享校验，
 * 后端据此落库与执行，前端据此展示审批/应用流程。
 */
import { z } from "zod";
import { isoDateTimeSchema } from "./common.js";

/**
 * 补丁作用目标：指明这次修改落在哪本书的哪个位置。
 * discriminatedUnion 按 kind 区分两种目标，保证字段与目标类型严格对应。
 */
export const statePatchTargetSchema = z.discriminatedUnion("kind", [
  // 整本书文件（如设定文档）：文件由 fileId 定位，无章节概念
  z.object({ kind: z.literal("book_file"), fileId: z.string().min(1) }).strict(),
  // 具体章节：由 chapterId 定位
  z.object({ kind: z.literal("chapter"), chapterId: z.string().min(1) }).strict()
]);

/**
 * 补丁生命周期状态。
 * 补丁必须先由用户批准，再由后端应用；失败/冲突时保留现场供人工介入。
 */
export const statePatchStatusSchema = z.enum([
  "proposed", // 已提交、等待用户审批
  "applying", // 审批通过，正在写入书稿
  "applied", // 已成功应用到书稿
  "rejected", // 用户拒绝，不应用
  "conflicted", // 应用时基址 hash 与预期不符，需要人工处理
  "failed" // 应用过程出错
]);

/** 提交补丁提案的输入：内容与理由必须齐全，便于用户判断是否批准。 */
export const statePatchProposalInputSchema = z.object({
  bookId: z.string().min(1),
  target: statePatchTargetSchema,
  proposedContent: z.string(),
  reason: z.string().min(1)
}).strict();

/** 补丁完整记录：含 hash 用于并发冲突检测（乐观锁），含备份路径用于回滚。 */
export const statePatchSchema = z.object({
  schemaVersion: z.literal("state-patch.v1"),
  id: z.string().min(1),
  runId: z.string().min(1),
  bookId: z.string().min(1),
  target: statePatchTargetSchema,
  status: statePatchStatusSchema,
  reason: z.string().min(1),
  baseHash: z.string().min(1), // 应用前书稿内容的 hash，作为乐观锁基准
  proposedHash: z.string().min(1), // 提案内容 hash，用于校验应用时内容未被篡改
  proposedContent: z.string(),
  backupFile: z.string().nullable(), // 应用前的备份文件路径，供回滚
  error: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  appliedAt: isoDateTimeSchema.nullable(),
  rejectedAt: isoDateTimeSchema.nullable()
}).strict();

/**
 * 批准补丁的输入：必须显式 approved: true（防止误传），
 * 且须携带应用前最新 baseHash，与库中记录比对做冲突检测。
 */
export const statePatchApplyInputSchema = z.object({
  approved: z.literal(true),
  expectedBaseHash: z.string().min(1)
}).strict();

/** 拒绝补丁的输入：必须给出理由，默认文案为「用户拒绝」。 */
export const statePatchRejectInputSchema = z.object({
  reason: z.string().trim().min(1).default("用户拒绝")
}).strict();

export type StatePatchTarget = z.infer<typeof statePatchTargetSchema>;
export type StatePatchStatus = z.infer<typeof statePatchStatusSchema>;
export type StatePatchProposalInput = z.infer<typeof statePatchProposalInputSchema>;
export type StatePatch = z.infer<typeof statePatchSchema>;

/**
 * 文件职责：定义运行（Run）核心契约：命令、创建请求、快照。
 * 后端根据 RunCommand 调度 Agent 执行，前端发起创建请求并消费 RunSnapshot 展示状态。
 */
import { z } from "zod";
import { isoDateTimeSchema, nonNegativeIntegerSchema } from "./common.js";

/**
 * Run 生命周期状态。
 * cancelled/failed/interrupted 为终态；cancelling 是收到取消请求到真正停止之间的过渡态。
 */
export const runStatusSchema = z.enum([
  "queued", // 已排队等待调度
  "running", // 正在执行
  "cancelling", // 已收到取消请求，正在停止
  "cancelled", // 已取消（终态）
  "completed", // 正常完成（终态）
  "failed", // 执行失败（终态）
  "interrupted" // 被中断，如进程重启（终态）
]);

/** 章节类命令的公共输入：默认值保证前端可提交最简指令。 */
const chapterCommandInputSchema = z.object({
  instruction: z.string().default(""), // 用户给 Agent 的补充指令，可留空
  selectedContextFileIds: z.array(z.string()).default([]), // 用户点选参考的上下文文件
  sceneType: z.string().default("auto"), // 场景类型，auto 表示由 Agent 自行判断
  allowDegradedStyle: z.boolean().default(false) // 是否允许在预算不足时降级模仿风格
}).strict();

/**
 * 可执行命令：按 type 区分五种业务动作。
 * discriminatedUnion 保证 type 与 payload 严格匹配，未定义的类型直接拒绝。
 */
export const runCommandSchema = z.discriminatedUnion("type", [
  z.object({
    schemaVersion: z.literal("run-command.v1"),
    type: z.literal("continue_chapter"), // 续写章节
    bookId: z.string().min(1),
    chapterId: z.string().min(1),
    input: chapterCommandInputSchema
  }).strict(),
  z.object({
    schemaVersion: z.literal("run-command.v1"),
    type: z.literal("review_chapter"), // 审阅章节
    bookId: z.string().min(1),
    chapterId: z.string().min(1),
    input: chapterCommandInputSchema
  }).strict(),
  z.object({
    schemaVersion: z.literal("run-command.v1"),
    type: z.literal("polish_chapter"), // 润色章节
    bookId: z.string().min(1),
    chapterId: z.string().min(1),
    input: chapterCommandInputSchema
  }).strict(),
  z.object({
    schemaVersion: z.literal("run-command.v1"),
    type: z.literal("initialize_book"), // 初始化整本书（建大纲、设定等）
    bookId: z.string().min(1),
    input: z.record(z.unknown())
  }).strict(),
  z.object({
    schemaVersion: z.literal("run-command.v1"),
    type: z.literal("consistency_check"), // 全书一致性检查
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
  legacyRunType: z.string().min(1), // 旧记录中的原始运行类型
  bookId: z.string().nullable(), // 旧数据可能未记录 bookId
  input: z.unknown()
}).strict();

/** 落库命令：新命令 + 迁移期旧命令，持久化与回放都走它。 */
export const persistedRunCommandSchema = z.union([runCommandSchema, legacyRunCommandSchema]);

/** 创建 Run 的请求：父 Run 与来源消息均可选，用于支持子任务与消息追溯。 */
export const runCreateRequestSchema = z.object({
  command: runCommandSchema,
  parentRunId: z.string().min(1).nullable().default(null), // 子任务链上的父 Run
  sessionId: z.string().min(1).nullable().default(null),
  triggerMessageId: z.string().min(1).nullable().default(null) // 触发本次运行的消息
}).strict();

/** Run 快照：单个 Run 的最新状态，供列表/详情查询与断点恢复。 */
export const runSnapshotSchema = z.object({
  schemaVersion: z.literal("run-snapshot.v1"),
  id: z.string().min(1),
  command: persistedRunCommandSchema,
  bookId: z.string().nullable(),
  chapterId: z.string().nullable(),
  parentRunId: z.string().nullable(),
  rootRunId: z.string().min(1), // 根 Run id，整棵任务树的根
  sessionId: z.string().nullable(),
  triggerMessageId: z.string().nullable(),
  status: runStatusSchema,
  currentStage: z.string().nullable(),
  configRevision: z.number().int().positive().nullable(), // 执行时使用的配置版本
  configHash: z.string().min(1).nullable(), // 配置内容 hash，与 revision 配合做一致性校验
  output: z.unknown().nullable(),
  error: z.unknown().nullable(),
  cancelRequestedAt: isoDateTimeSchema.nullable(),
  lastEventSeq: nonNegativeIntegerSchema, // 已持久化事件的最后序号，断点恢复起点
  createdAt: isoDateTimeSchema,
  queuedAt: isoDateTimeSchema.nullable(),
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
  updatedAt: isoDateTimeSchema
}).strict();

/** 创建请求被接受后的回执：status 固定 queued，并给出事件流地址。 */
export const runAcceptedSchema = z.object({
  runId: z.string().min(1),
  status: z.literal("queued"),
  eventsUrl: z.string().min(1), // 事件流订阅地址
  acceptedAt: isoDateTimeSchema
}).strict();

export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunCommand = z.infer<typeof runCommandSchema>;
export type LegacyRunCommand = z.infer<typeof legacyRunCommandSchema>;
export type PersistedRunCommand = z.infer<typeof persistedRunCommandSchema>;
export type RunCreateRequest = z.infer<typeof runCreateRequestSchema>;
export type RunSnapshot = z.infer<typeof runSnapshotSchema>;
export type RunAccepted = z.infer<typeof runAcceptedSchema>;

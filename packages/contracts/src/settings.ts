/**
 * 文件职责：定义应用全局配置（AppConfig）契约：分段结构、版本化校验与部分更新（patch）。
 * 后端负责加载/持久化配置（文件+环境变量合并），前端用于展示与提交修改。
 */
import { z } from "zod";

/** 模型调用重试配置：限制单模型与总体尝试次数，指数退避区间以毫秒为单位。 */
const retryConfigSchema = z.object({
  maxAttemptsPerModel: z.number().int().min(1).max(10),
  maxTotalAttempts: z.number().int().min(1).max(20),
  baseDelayMs: z.number().int().min(0).max(60_000),
  maxDelayMs: z.number().int().min(0).max(300_000)
}).strict();

/** 上下文各分区的 token 预算：总和不得超过模型上下文窗口（由调度器约束）。 */
const contextBudgetsSchema = z.object({
  stableMaxTokens: z.number().int().positive(), // 稳定区（设定等）
  factsMaxTokens: z.number().int().positive(), // 事实区
  sceneMaxTokens: z.number().int().positive(), // 场景区
  recentMaxTokens: z.number().int().positive(), // 最近对话区
  sessionMaxTokens: z.number().int().positive(), // 会话历史区
  skillsMaxTokens: z.number().int().positive(), // 技能区
  turnMinTokens: z.number().int().positive() // 单轮输出保留的最小余量
}).strict();

/**
 * 配置分段（不含版本号）：按主题分组，所有数值字段都带硬边界，
 * 防止配置文件/环境变量误配导致运行时资源失控。
 */
export const appConfigSectionsSchema = z.object({
  general: z.object({
    locale: z.string().min(1),
    autosaveIntervalMs: z.number().int().min(1_000).max(3_600_000) // 自动保存间隔
  }).strict(),
  runtime: z.object({
    globalConcurrency: z.number().int().min(1).max(32), // 全局并发上限
    perBookMutationConcurrency: z.number().int().min(1).max(8), // 单书写操作并发
    queueLimit: z.number().int().min(1).max(10_000), // 任务队列上限
    shutdownGraceMs: z.number().int().min(1_000).max(300_000) // 优雅停机宽限期
  }).strict(),
  events: z.object({
    heartbeatMs: z.number().int().min(1_000).max(120_000),
    streamBatchIntervalMs: z.number().int().min(10).max(10_000), // 流式批次合并间隔
    streamBatchCharacters: z.number().int().min(128).max(65_536),
    replayLimit: z.number().int().min(1).max(100_000), // 事件重放上限
    inlinePayloadMaxBytes: z.number().int().min(1_024).max(1_048_576) // 事件内联 payload 上限
  }).strict(),
  models: z.object({
    defaultTimeoutMs: z.number().int().min(1_000).max(900_000),
    retry: retryConfigSchema
  }).strict(),
  context: z.object({
    defaultContextWindow: z.number().int().min(4_096), // 默认上下文窗口大小
    defaultMaxOutputTokens: z.number().int().min(256),
    safetyMarginRatio: z.number().min(0.01).max(0.5), // 预留安全余量占比
    compressionThresholdRatio: z.number().min(0.5).max(0.95), // 触发压缩的占用比
    budgets: contextBudgetsSchema
  }).strict(),
  sessions: z.object({
    searchResultLimit: z.number().int().min(1).max(200),
    searchSnippetCharacters: z.number().int().min(50).max(5_000), // 搜索摘要长度
    recentMessageLimit: z.number().int().min(1).max(500) // 上下文重建取的最近消息数
  }).strict(),
  patches: z.object({
    approvalRequired: z.literal(true), // 安全约束：状态补丁必须人工审批，禁止关闭
    keepBeforeApplyBackup: z.boolean() // 应用前是否保留备份文件
  }).strict(),
  memory: z.object({
    enabled: z.boolean(),
    writeApprovalRequired: z.literal(true), // 安全约束：记忆写入必须审批，禁止关闭
    promptTokenBudget: z.number().int().min(128).max(16_000),
    maxActiveEntries: z.number().int().min(1).max(1_000)
  }).strict(),
  skills: z.object({
    enabled: z.boolean(),
    writeApprovalRequired: z.boolean(),
    maxLoadedSkills: z.number().int().min(1).max(20),
    promptTokenBudget: z.number().int().min(128).max(32_000)
  }).strict(),
  storage: z.object({
    sqliteBusyTimeoutMs: z.number().int().min(100).max(120_000),
    backupBeforeMigration: z.boolean(), // 迁移前是否自动备份数据库
    automaticPruning: z.literal(false) // 自动清理暂不支持，先固定关闭
  }).strict(),
  plugins: z.object({ enabled: z.boolean() }).strict(),
  mcp: z.object({ enabled: z.boolean() }).strict(),
  cron: z.object({
    enabled: z.boolean(),
    timezone: z.string().min(1), // 定时任务的 IANA 时区
    maxConcurrentJobs: z.number().int().min(1).max(32),
    // 漏跑策略：skip 跳过、run_once 只补跑一次、bounded_catch_up 限量补跑
    misfirePolicy: z.enum(["skip", "run_once", "bounded_catch_up"])
  }).strict(),
  features: z.object({
    asyncRuns: z.boolean(), // 异步运行
    agentLoop: z.boolean(), // Agent 自主循环
    patchApply: z.boolean(), // 补丁应用
    skills: z.boolean(),
    plugins: z.boolean(),
    mcp: z.boolean(),
    cron: z.boolean()
  }).strict()
}).strict();

/** 完整配置：带 schemaVersion 与 revision（每次更新递增，供乐观锁比较）。 */
export const appConfigSchema = appConfigSectionsSchema.extend({
  schemaVersion: z.literal("app-config.v1"),
  revision: z.number().int().positive()
}).strict();

/** 部分更新：expectedRevision 做乐观锁，changes 只允许分段深层部分覆盖。 */
export const appConfigPatchSchema = z.object({
  expectedRevision: z.number().int().positive(), // 客户端持有的版本，与库中不符则拒绝
  changes: appConfigSectionsSchema.deepPartial()
}).strict();

export type AppConfig = z.infer<typeof appConfigSchema>;
export type AppConfigSections = z.infer<typeof appConfigSectionsSchema>;
export type AppConfigPatch = z.infer<typeof appConfigPatchSchema>;

/** 生效配置查询响应：含各字段来源（默认/文件/环境变量）、锁定字段与需重启字段。 */
export interface EffectiveConfigResponse {
  effectiveConfig: AppConfig;
  revision: number;
  configHash: string; // 配置内容 hash，供运行快照关联
  sources: Record<string, "default" | "file" | "environment">; // 每个字段的生效来源
  lockedFields: string[]; // 被锁定、不可修改的字段
  restartRequiredFields: string[]; // 修改后需重启才生效的字段
}

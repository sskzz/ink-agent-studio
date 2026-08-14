/**
 * 作品运行时状态（runtime.json）与状态增量（delta）的 Zod schema。
 * 权威状态设计（借鉴 InkOS 的三层记忆架构）：
 * - runtime.json 是**结构化权威状态**：baseline（初始化产出）+ 各章 delta + 合成后的 state，
 *   全部字段受 Zod 严格校验，坏数据直接拒绝；
 * - current.md / foreshadowing.md 降级为人类可读投影（由 state 渲染，不再作为事实源）；
 * - 章节写完后由 Observer 输出 JSON delta，代码层 immutable 应用，避免模型直接改文件。
 */
import { z } from "zod";
import { worldRuleProposalSchema } from "./storyKnowledgeSchemas.js";

/** 实体/伏笔 ID：小写英文 + 连字符（与初始化 schema 保持一致）。 */
const identifierSchema = z.string().regex(/^[a-z][a-z0-9-]{2,63}$/);

/** 短文本：1-500 字符。 */
const shortText = z.string().trim().min(1).max(500);

/** 伏笔状态枚举：与初始化阶段一致，另加整数型推进章节（lastAdvancedChapter）。 */
export const runtimeForeshadowingStatusSchema = z.enum(["planned", "planted", "advancing", "resolving", "resolved", "archived"]);
export const runtimeForeshadowingScheduleStatusSchema = z.enum(["on_track", "due", "overdue"]);

/** 单条伏笔（结构化）：状态机 + 推进章节号，供审计与检索使用。 */
export const runtimeForeshadowingSchema = z.object({
  id: identifierSchema,
  content: shortText,
  relatedEntityIds: z.array(identifierSchema).max(8).default([]),
  placement: shortText,
  resolution: shortText,
  /** 长线/短线伏笔分池；旧数据默认 short，不影响读取。 */
  horizon: z.enum(["short", "long"]).optional(),
  /** 明确回收章节范围；没有结构化范围的旧数据由调度器尝试从 resolution 文本解析。 */
  targetChapterRange: z.object({
    start: z.number().int().positive(),
    end: z.number().int().positive()
  }).nullable().optional(),
  status: runtimeForeshadowingStatusSchema,
  scheduleStatus: runtimeForeshadowingScheduleStatusSchema.optional(),
  missedCount: z.number().int().nonnegative().optional(),
  /** 最近一次推进该伏笔的章节号；未推进过为 null。 */
  lastAdvancedChapter: z.number().int().positive().nullable().default(null)
});

/** Observer 只输出伏笔发生变化的字段，稳定描述由代码层从权威状态合并。 */
export const observedForeshadowingDeltaSchema = z.object({
  id: identifierSchema,
  status: runtimeForeshadowingStatusSchema,
  lastAdvancedChapter: z.number().int().positive()
});

/** 人物/势力/物品状态条目。 */
export const runtimeCharacterStateSchema = z.object({
  characterId: identifierSchema,
  state: shortText
});
export const runtimeFactionStateSchema = z.object({
  factionId: identifierSchema,
  state: shortText
});
export const runtimeItemStateSchema = z.object({
  itemId: identifierSchema,
  state: shortText
});

/** 权威状态视图（baseline 与合成 state 共用同一结构）。 */
export const runtimeStateViewSchema = z.object({
  storyStart: shortText,
  publicFacts: z.array(shortText).max(20).default([]),
  secrets: z.array(shortText).max(20).default([]),
  nextGoals: z.array(shortText).max(20).default([]),
  characterStates: z.array(runtimeCharacterStateSchema).max(40).default([]),
  factionStates: z.array(runtimeFactionStateSchema).max(20).default([]),
  itemStates: z.array(runtimeItemStateSchema).max(30).default([]),
  foreshadowing: z.array(runtimeForeshadowingSchema).max(40).default([])
});

/** 状态增量：Observer 从章节正文提取的结构化变更，代码层 immutable 应用。 */
export const stateDeltaSchema = z.object({
  schemaVersion: z.literal("book-state-delta.v1"),
  /** 本章摘要（写入 chapterSummaries）。 */
  summary: z.string().trim().max(1000).optional(),
  /** 观察到的实体 id 列表（供记忆检索落库）。 */
  entities: z.array(identifierSchema).max(20).optional(),
  characterStates: z.array(runtimeCharacterStateSchema).max(20).optional(),
  factionStates: z.array(runtimeFactionStateSchema).max(10).optional(),
  itemStates: z.array(runtimeItemStateSchema).max(20).optional(),
  /** 伏笔变更：按 id upsert（可更新状态/内容/投放回收/推进章节）。 */
  foreshadowing: z.array(runtimeForeshadowingSchema).max(20).optional(),
  /** 剧情新信息对世界规则库的演进提案；规则改写必须审批，新剧情事实可确定性自动吸收。 */
  worldRuleProposals: z.array(worldRuleProposalSchema).max(20).optional()
});

/** 模型观察输出：与持久化 StateDelta 分离，避免要求模型重复稳定字段。 */
export const observedStateDeltaSchema = stateDeltaSchema.omit({ foreshadowing: true }).extend({
  foreshadowing: z.array(observedForeshadowingDeltaSchema).max(20).optional()
});

/** 章节 delta 记录（含章节 id，保证可重放与回滚）。 */
export const runtimeStateDeltaRecordSchema = z.object({
  chapterId: z.string().min(1),
  chapterNo: z.number().int().positive().default(1),
  chapterRevision: z.number().int().positive().default(1),
  observationRevision: z.number().int().positive().default(1),
  contentHash: z.string().min(1).default("legacy"),
  recordedAt: z.string().default("1970-01-01T00:00:00.000Z"),
  delta: stateDeltaSchema
});

/** 历史快照记录：每章应用 delta 前的权威状态快照（增量合成 + 删除回滚用）。 */
export const runtimeStateHistoryRecordSchema = z.object({
  chapterId: z.string().min(1),
  chapterNo: z.number().int().positive().default(1),
  chapterRevision: z.number().int().positive().default(1),
  snapshot: runtimeStateViewSchema
});

/** 运行时权威状态文件结构。 */
export const runtimeStateSchema = z.object({
  schemaVersion: z.literal("book-runtime-state.v1"),
  baseline: runtimeStateViewSchema,
  /** 各章产生的 delta 序列（按顺序增量应用；删除章节时按该章快照回滚并重放后续章节）。 */
  deltas: z.array(runtimeStateDeltaRecordSchema).default([]),
  /** 历史快照栈：每章应用前的 state（增量合成：保存 O(1)，不再从 baseline 全量重放）。 */
  history: z.array(runtimeStateHistoryRecordSchema).max(50).default([]),
  /** 合成后的权威状态（baseline + 全部 delta 增量应用结果）。 */
  state: runtimeStateViewSchema,
  chapterSummaries: z.record(z.string(), z.string().max(1000)).default({})
});

export type RuntimeForeshadowing = z.infer<typeof runtimeForeshadowingSchema>;
export type RuntimeStateView = z.infer<typeof runtimeStateViewSchema>;
export type StateDelta = z.infer<typeof stateDeltaSchema>;
export type ObservedStateDelta = z.infer<typeof observedStateDeltaSchema>;
export type RuntimeStateDeltaRecord = z.infer<typeof runtimeStateDeltaRecordSchema>;
export type RuntimeStateHistoryRecord = z.infer<typeof runtimeStateHistoryRecordSchema>;
export type RuntimeState = z.infer<typeof runtimeStateSchema>;

import { z } from "zod";

/** 作品知识层共用的稳定标识符。所有关系与专名都以 id 关联，禁止只依赖字符串猜测。 */
export const storyKnowledgeIdentifierSchema = z.string().regex(/^[a-z][a-z0-9-]{2,63}$/);
const shortText = z.string().trim().min(1).max(500);
const conciseText = z.string().trim().min(1).max(240);

/** 专名锁定表。正文生成只注入当前章命中的少量条目，避免全书术语表撑爆上下文。 */
export const lockedTermSchema = z.object({
  id: storyKnowledgeIdentifierSchema,
  term: z.string().trim().min(1).max(80),
  aliases: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  category: z.enum(["character", "faction", "location", "item", "rule", "event", "custom"]),
  locked: z.boolean().default(true),
  note: z.string().trim().max(300).default("")
}).strict();

/** 章级五维度：章节正文的硬性剧情合同，而不是一个难以检索的长段落。 */
export const chapterFiveDimensionsSchema = z.object({
  synopsis: conciseText,
  characterActions: z.array(z.object({
    characterId: storyKnowledgeIdentifierSchema,
    action: conciseText,
    expectedState: z.string().trim().max(240).optional()
  }).strict()).min(1).max(12),
  scenes: z.array(conciseText).min(1).max(8),
  conflicts: z.array(conciseText).min(1).max(6),
  narrativeGoals: z.array(conciseText).min(1).max(6)
}).strict();

export const storyPlanChapterSchema = z.object({
  chapterNo: z.number().int().min(1).max(1_000),
  volumeNo: z.number().int().min(1).max(100),
  title: z.string().trim().min(1).max(100),
  dimensions: chapterFiveDimensionsSchema,
  lockedTermIds: z.array(storyKnowledgeIdentifierSchema).max(30).default([]),
  status: z.enum(["draft", "reviewing", "approved", "blocked"]).default("draft"),
  reviewNotes: z.array(z.string().trim().min(1).max(300)).max(20).default([])
}).strict();

export const storyPlanVolumeSchema = z.object({
  id: storyKnowledgeIdentifierSchema,
  volumeNo: z.number().int().min(1).max(100),
  title: z.string().trim().min(1).max(100),
  chapterRange: z.object({
    start: z.number().int().min(1).max(1_000),
    end: z.number().int().min(1).max(1_000)
  }).strict(),
  objective: conciseText,
  conflict: conciseText,
  turningPoint: conciseText,
  climax: conciseText,
  resolution: conciseText,
  characterChanges: z.array(conciseText).max(30).default([])
}).strict();

export const storyPlanBatchSchema = z.object({
  id: storyKnowledgeIdentifierSchema,
  batchNo: z.number().int().min(1).max(100),
  chapterRange: z.object({
    start: z.number().int().min(1).max(1_000),
    end: z.number().int().min(1).max(1_000)
  }).strict(),
  status: z.enum(["draft", "generating", "reviewing", "approved", "blocked"]).default("draft"),
  qualityGate: z.object({
    passed: z.boolean(),
    checkedAt: z.string(),
    blockingIssues: z.array(z.string()).max(100),
    warnings: z.array(z.string()).max(100),
    repairAttempts: z.number().int().min(0).max(2)
  }).nullable().default(null)
}).strict();

/**
 * 三层千章大纲的权威文件。
 * chapters 保持按批次按需生成；初始化只创建卷与批次壳，避免一次调用产出 1000 章造成高成本和低质量。
 */
export const storyPlanSchema = z.object({
  schemaVersion: z.literal("story-plan.v1"),
  bookId: z.string().min(1),
  mainLine: shortText,
  plannedChapterCount: z.number().int().min(50).max(1_000),
  terms: z.array(lockedTermSchema).max(300).default([]),
  volumes: z.array(storyPlanVolumeSchema).min(1).max(100),
  batches: z.array(storyPlanBatchSchema).min(1).max(100),
  chapters: z.array(storyPlanChapterSchema).max(1_000).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
}).strict();

/** 五层人物模型：基础档案、成长弧、时间线、关系图谱、对话 DNA。 */
export const characterProfileSchema = z.object({
  schemaVersion: z.literal("character-profile.v1"),
  core: z.object({
    appearance: z.string().trim().max(500).default(""),
    personalityTraits: z.array(conciseText).max(20).default([]),
    motivations: z.array(conciseText).max(20).default([]),
    values: z.array(conciseText).max(15).default([]),
    hardConstraints: z.array(conciseText).max(20).default([]),
    prohibitedActions: z.array(z.string().trim().min(1).max(120)).max(20).default([])
  }).strict(),
  arc: z.object({
    startState: z.string().trim().max(300).default(""),
    targetState: z.string().trim().max(300).default(""),
    milestones: z.array(z.object({
      chapterRange: z.object({ start: z.number().int().min(1).max(1_000), end: z.number().int().min(1).max(1_000) }).strict(),
      change: conciseText
    }).strict()).max(30).default([])
  }).strict(),
  timeline: z.object({
    currentState: z.string().trim().max(500).default(""),
    knownHistory: z.array(conciseText).max(30).default([])
  }).strict(),
  relationships: z.array(z.object({
    targetCharacterId: storyKnowledgeIdentifierSchema,
    relation: conciseText,
    tension: z.string().trim().max(240).default(""),
    allowedDirection: z.string().trim().max(240).default("")
  }).strict()).max(50).default([]),
  dialogueDna: z.object({
    voice: z.string().trim().max(300).default(""),
    sentenceRhythm: z.string().trim().max(200).default(""),
    signaturePhrases: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    forbiddenExpressions: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
    subtextHabits: z.array(conciseText).max(15).default([])
  }).strict()
}).strict();

/** 世界规则库条目。不可变规则永不被 Observer 自动覆盖。 */
export const worldRuleSchema = z.object({
  id: storyKnowledgeIdentifierSchema,
  title: z.string().trim().min(1).max(120),
  content: conciseText,
  category: z.enum(["law", "setting", "history", "story_fact"]),
  mutability: z.enum(["immutable", "mutable"]),
  /** 供零 Token 生成后审核使用的显式禁用表达；自然语言规则仍作为 Prompt 软约束。 */
  prohibitedExpressions: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  status: z.enum(["active", "superseded", "archived"]),
  source: z.enum(["initialization", "user", "chapter-observer"]),
  sourceChapterNo: z.number().int().min(1).max(1_000).nullable().default(null),
  evidence: z.string().trim().max(500).default(""),
  createdAt: z.string(),
  updatedAt: z.string()
}).strict();

/** 章节观察者只提出变化；代码校验证据后仅自动吸收“新增剧情事实”，规则改写始终保留审批。 */
export const worldRuleProposalSchema = z.object({
  kind: z.enum(["new_fact", "rule_update"]),
  title: z.string().trim().min(1).max(120),
  content: conciseText,
  evidence: z.string().trim().min(1).max(500),
  targetRuleId: storyKnowledgeIdentifierSchema.nullable().optional()
}).strict();

export const storedWorldRuleProposalSchema = worldRuleProposalSchema.extend({
  id: storyKnowledgeIdentifierSchema,
  chapterNo: z.number().int().min(1).max(1_000),
  status: z.enum(["applied", "proposed", "rejected"]),
  reason: z.string().trim().max(500).default(""),
  createdAt: z.string(),
  reviewedAt: z.string().nullable().default(null)
}).strict();

export const worldRuleRegistrySchema = z.object({
  schemaVersion: z.literal("world-rule-registry.v1"),
  bookId: z.string().min(1),
  rules: z.array(worldRuleSchema).max(500).default([]),
  proposals: z.array(storedWorldRuleProposalSchema).max(1_000).default([]),
  updatedAt: z.string()
}).strict();

export const legacyKnowledgeBackfillDecisionStatusSchema = z.enum(["pending", "accepted", "rejected"]);

/**
 * 回填审核项使用稳定 itemKey 定位，editedValue 在服务层按条目类型再次经过对应 schema 校验。
 * 这里保留 unknown 是为了让单一审核协议可以覆盖大纲、规则和人物档案三类异构数据。
 */
export const legacyKnowledgeBackfillDecisionSchema = z.object({
  itemKey: z.string().trim().min(1).max(160),
  status: legacyKnowledgeBackfillDecisionStatusSchema,
  editedValue: z.unknown().optional(),
  reason: z.string().trim().max(500).default(""),
  reviewedAt: z.string().nullable().default(null)
}).strict();

/** 旧作品知识回填提案：先落独立提案文件，显式应用时仍禁止覆盖已存在的权威知识。 */
export const legacyKnowledgeBackfillProposalSchema = z.object({
  schemaVersion: z.literal("legacy-knowledge-backfill.v1"),
  id: storyKnowledgeIdentifierSchema,
  bookId: z.string().min(1),
  status: z.enum(["proposed", "applied", "superseded"]),
  sourceHash: z.string().min(1),
  storyPlan: storyPlanSchema.nullable(),
  worldRules: worldRuleRegistrySchema.nullable(),
  characterProfiles: z.array(z.object({
    entityId: z.string().min(1),
    characterName: z.string().min(1),
    profile: characterProfileSchema
  }).strict()).max(200),
  decisions: z.array(legacyKnowledgeBackfillDecisionSchema).max(1_000).default([]),
  warnings: z.array(z.string().trim().min(1).max(500)).max(100),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  appliedAt: z.string().nullable()
}).strict();

export const knowledgeAuditDecisionSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  decision: z.enum(["confirmed", "exempted"]),
  reason: z.string().trim().min(1).max(500),
  issueCode: z.string().trim().min(1).max(100),
  sourceId: z.string().trim().min(1).max(160),
  createdAt: z.string(),
  updatedAt: z.string()
}).strict();

export const knowledgeAuditDecisionRegistrySchema = z.object({
  schemaVersion: z.literal("knowledge-audit-decisions.v1"),
  bookId: z.string().min(1),
  decisions: z.array(knowledgeAuditDecisionSchema).max(5_000).default([]),
  updatedAt: z.string()
}).strict();

export type StoryPlan = z.infer<typeof storyPlanSchema>;
export type StoryPlanBatch = z.infer<typeof storyPlanBatchSchema>;
export type StoryPlanChapter = z.infer<typeof storyPlanChapterSchema>;
export type CharacterProfile = z.infer<typeof characterProfileSchema>;
export type WorldRule = z.infer<typeof worldRuleSchema>;
export type WorldRuleProposal = z.infer<typeof worldRuleProposalSchema>;
export type WorldRuleRegistry = z.infer<typeof worldRuleRegistrySchema>;
export type LegacyKnowledgeBackfillDecision = z.infer<typeof legacyKnowledgeBackfillDecisionSchema>;
export type LegacyKnowledgeBackfillProposal = z.infer<typeof legacyKnowledgeBackfillProposalSchema>;
export type KnowledgeAuditDecision = z.infer<typeof knowledgeAuditDecisionSchema>;
export type KnowledgeAuditDecisionRegistry = z.infer<typeof knowledgeAuditDecisionRegistrySchema>;

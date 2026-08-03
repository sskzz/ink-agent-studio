/**
 * 文件职责：定义小说创作技能（Skill）契约：元数据、详情、选择轨迹与增改输入。
 * 技能是「带指令提示词的写作方法论插件」，后端存储并加载，前端展示与审批。
 */
import { z } from "zod";
import { isoDateTimeSchema } from "./common.js";

/** 技能适用的创作环节。 */
export const novelSkillOperationSchema = z.enum(["planning", "writing", "review"]);
/** 技能来源：内置（builtin）不可修改，自定义（custom）由用户创建。 */
export const novelSkillSourceSchema = z.enum(["builtin", "custom"]);

/**
 * 技能元数据：id 限定小写字母数字短横线（kebab-case），
 * instructionHash 为指令内容 hash，用于发现重复技能与校验版本一致性。
 */
export const novelSkillMetadataSchema = z.object({
  schemaVersion: z.literal("novel-skill.v1"),
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), // kebab-case，如 "character-voice"
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  version: z.number().int().positive(), // 技能版本，改版时递增
  source: novelSkillSourceSchema,
  enabled: z.boolean(),
  appliesTo: z.array(novelSkillOperationSchema).min(1), // 至少适用一个环节
  triggerTerms: z.array(z.string().trim().min(1).max(80)).max(50), // 触发词，最多 50 个
  priority: z.number().int().min(1).max(100), // 优先级，越高越先加载
  instructionHash: z.string().regex(/^[a-f0-9]{64}$/), // sha256 十六进制
  instructionEstimatedTokens: z.number().int().positive(), // 指令预估 token，参与预算控制
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
}).strict();

/** 技能详情 = 元数据 + 完整指令正文（指令最长 10 万字符）。 */
export const novelSkillDetailSchema = z.object({
  metadata: novelSkillMetadataSchema,
  instructions: z.string().min(1).max(100_000)
}).strict();

/** 技能选择预览输入：给定操作与上下文，预演会选中哪些技能。 */
export const novelSkillPreviewInputSchema = z.object({
  operation: novelSkillOperationSchema,
  instruction: z.string().max(100_000).default(""),
  context: z.string().max(100_000).default(""),
  requestedSkillIds: z.array(z.string()).max(20).default([]) // 用户显式指定要用的技能
}).strict();

/** 被选中技能的一条：含匹配得分与命中触发词，供前端解释"为什么选中"。 */
export const novelSkillSelectionItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  score: z.number(), // 匹配得分
  explicit: z.boolean(), // 是否用户显式点名而非自动匹配
  matchedTerms: z.array(z.string()), // 命中的触发词
  includedEstimatedTokens: z.number().int().nonnegative(), // 计入上下文的 token 数
  truncated: z.boolean(), // 因预算被截断
  instructionHash: z.string()
}).strict();

/** 技能选择结果：完整提示词 + 选择轨迹（含被跳过的技能与降级原因）。 */
export const novelSkillSelectionSchema = z.object({
  prompt: z.string(),
  trace: z.object({
    schemaVersion: z.literal("skill-selection-trace.v1"),
    operation: novelSkillOperationSchema,
    metadataScanned: z.number().int().nonnegative(), // 扫描的元数据条数
    maxLoadedSkills: z.number().int().positive(), // 预算允许加载的最大技能数
    promptTokenBudget: z.number().int().positive(), // 技能区 token 预算
    totalEstimatedTokens: z.number().int().nonnegative(), // 实际占用
    selected: z.array(novelSkillSelectionItemSchema),
    skipped: z.array(z.object({ id: z.string(), reason: z.string() }).strict()), // 未选中的技能及原因
    degradedReasons: z.array(z.string()) // 触发降级的原因列表
  }).strict()
}).strict();

/** 创建自定义技能：approved 必须为 true，各字段复用元数据校验规则。 */
export const novelSkillCreateInputSchema = z.object({
  approved: z.literal(true),
  id: novelSkillMetadataSchema.shape.id,
  name: novelSkillMetadataSchema.shape.name,
  description: novelSkillMetadataSchema.shape.description,
  appliesTo: novelSkillMetadataSchema.shape.appliesTo,
  triggerTerms: novelSkillMetadataSchema.shape.triggerTerms,
  priority: novelSkillMetadataSchema.shape.priority.default(50),
  instructions: z.string().trim().min(1).max(100_000)
}).strict();

/** 切换技能启停状态：同样要求显式审批通过。 */
export const novelSkillStatusInputSchema = z.object({
  enabled: z.boolean(),
  approved: z.literal(true)
}).strict();

export type NovelSkillOperation = z.infer<typeof novelSkillOperationSchema>;
export type NovelSkillMetadata = z.infer<typeof novelSkillMetadataSchema>;
export type NovelSkillDetail = z.infer<typeof novelSkillDetailSchema>;
export type NovelSkillPreviewInput = z.infer<typeof novelSkillPreviewInputSchema>;
export type NovelSkillSelection = z.infer<typeof novelSkillSelectionSchema>;
export type NovelSkillCreateInput = z.infer<typeof novelSkillCreateInputSchema>;

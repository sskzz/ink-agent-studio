/**
 * 文件职责：定义用户长期记忆（偏好）契约：偏好条目、提议/审批/归档输入与记忆选择轨迹。
 * 后端持久化偏好并在各环节注入上下文，前端展示偏好状态并做审批。
 */
import { z } from "zod";
import { isoDateTimeSchema } from "./common.js";

/** 偏好所属类别：决定偏好被注入到哪个创作环节。 */
export const userPreferenceCategorySchema = z.enum(["writing", "review", "workflow", "formatting"]);
/** 偏好的键：由系统统一定义，避免自由文本键导致语义分裂。 */
export const userPreferenceKeySchema = z.enum([
  "narrative_pacing", // 叙事节奏
  "paragraph_length", // 段落长度
  "dialogue_density", // 对话密度
  "description_density", // 描写密度
  "emotion_expression", // 情感表达方式
  "banned_expressions", // 禁用表达
  "review_strictness", // 审阅严格度
  "revision_scope", // 修改范围
  "output_format", // 输出格式
  "interaction_style" // 交互风格
]);
/** 偏好生命周期：提议后需用户审批才能生效，拒绝/归档后不再注入。 */
export const userPreferenceStatusSchema = z.enum(["proposed", "active", "rejected", "archived"]);

/**
 * 偏好条目：value 与 reason 均必填（500 字上限），
 * 支持 replaced 链（replacesPreferenceId）与来源消息追溯。
 */
export const userPreferenceSchema = z.object({
  schemaVersion: z.literal("user-preference.v1"),
  id: z.string().min(1),
  category: userPreferenceCategorySchema,
  key: userPreferenceKeySchema,
  value: z.string().trim().min(1).max(500),
  reason: z.string().trim().min(1).max(500), // 提出该偏好的依据，便于用户判断
  rejectionReason: z.string().trim().min(1).max(500).nullable(),
  status: userPreferenceStatusSchema,
  priority: z.number().int().min(1).max(100), // 优先级，冲突时高者生效
  tokenEstimate: z.number().int().positive(), // 注入上下文时的 token 占用
  sourceSessionId: z.string().nullable(), // 偏好来源会话（聊天中提出时）
  sourceMessageId: z.string().nullable(),
  replacesPreferenceId: z.string().nullable(), // 被本偏好替代的旧条目 id
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  approvedAt: isoDateTimeSchema.nullable(),
  rejectedAt: isoDateTimeSchema.nullable(),
  archivedAt: isoDateTimeSchema.nullable()
}).strict();

/**
 * 提交偏好提议：带来源消息时必须同时带来源会话（superRefine 交叉校验），
 * 保证追溯链完整，不会出现只有 messageId 无法定位会话的情况。
 */
export const userPreferenceProposalInputSchema = z.object({
  category: userPreferenceCategorySchema,
  key: userPreferenceKeySchema,
  value: userPreferenceSchema.shape.value,
  reason: userPreferenceSchema.shape.reason,
  priority: userPreferenceSchema.shape.priority.default(50),
  sourceSessionId: z.string().min(1).nullable().default(null),
  sourceMessageId: z.string().min(1).nullable().default(null)
}).strict().superRefine((input, context) => {
  if (input.sourceMessageId && !input.sourceSessionId) {
    context.addIssue({
      code: "custom",
      path: ["sourceSessionId"],
      message: "关联来源消息时必须同时提供来源 Session"
    });
  }
});

/** 审批偏好：必须显式 approved: true，防止误操作直接生效。 */
export const userPreferenceApprovalInputSchema = z.object({ approved: z.literal(true) }).strict();
/** 拒绝偏好：必须给出拒绝原因，供系统调整后续提议。 */
export const userPreferenceRejectionInputSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
/** 归档偏好：把已失效的偏好移出注入范围。 */
export const userPreferenceArchiveInputSchema = z.object({ approved: z.literal(true) }).strict();

/** 记忆选择结果：含注入提示词与选择轨迹，说明哪些条目被选中/截断。 */
export const userMemorySelectionSchema = z.object({
  prompt: z.string(),
  trace: z.object({
    schemaVersion: z.literal("user-memory-trace.v1"),
    enabled: z.boolean(), // 记忆功能是否启用
    activeScanned: z.number().int().nonnegative(), // 扫描的活跃条目数
    promptTokenBudget: z.number().int().positive(), // 记忆区 token 预算
    totalEstimatedTokens: z.number().int().nonnegative(),
    selectedIds: z.array(z.string()),
    truncatedIds: z.array(z.string()) // 因预算不足被截断的条目
  }).strict()
}).strict();

export type UserPreference = z.infer<typeof userPreferenceSchema>;
export type UserPreferenceProposalInput = z.infer<typeof userPreferenceProposalInputSchema>;
export type UserMemorySelection = z.infer<typeof userMemorySelectionSchema>;

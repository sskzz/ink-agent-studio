import { z } from "zod";

/**
 * 事实卡（fact card）相关 Zod schema。
 * 事实卡是作品设定一致性的最小治理单元：后续生成阶段只允许引用已有卡或声明新卡，
 * 不可变卡（用户裁决 / 已锁定规则）在生成时必须逐字回注，机器校验负责拦截改写。
 */

/**
 * 事实卡类型：setting 设定 / entity 实体 / event 事件 / timeline 时间线 / rule 规则 / promise 承诺。
 */
export const factCardKindSchema = z.enum(["setting", "entity", "event", "timeline", "rule", "promise"]);

/** 事实卡来源：区分用户人工录入与 AI 生成，决定可信度与是否允许机器改写。 */
export const factCardSourceSchema = z.enum([
  "user-brief",
  "user-world",
  "ai-foundation",
  "ai-world",
  "ai-story-graph",
  "ai-story-backbone",
  "ai-outline",
  "ai-initial-state",
  "summary"
]);

/** 可变性：immutable 卡生成时必须逐字回注，mutable 卡允许合理改写。 */
export const factCardMutabilitySchema = z.enum(["immutable", "mutable"]);

/**
 * 事实卡记录结构（严格模式，拒绝未知字段）。
 * content 限制 1-200 字，强制事实卡保持原子；refs 引用其他事实卡 id。
 */
export const factCardSchema = z.object({
  schemaVersion: z.literal("fact-card.v1"),
  id: z.string().regex(/^fact:[a-z0-9-]{1,63}$/),
  kind: factCardKindSchema,
  version: z.number().int().min(1),
  status: z.enum(["active", "archived", "superseded"]).default("active"),
  mutability: factCardMutabilitySchema.default("mutable"),
  source: factCardSourceSchema,
  content: z.string().trim().min(1).max(200),
  refs: z.array(z.string()).max(20).default([]),
  constraints: z.array(z.string()).max(10).default([])
}).strict();

/** 事实卡集合结构。 */
export const factCardListSchema = z.array(factCardSchema);
export type FactCard = z.infer<typeof factCardSchema>;
export type FactCardKind = z.infer<typeof factCardKindSchema>;
export type FactCardSource = z.infer<typeof factCardSourceSchema>;

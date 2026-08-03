import { z } from "zod";

/**
 * 实体（人物 / 阵营 / 地点 / 物品）相关 Zod schema。
 */

/** 实体类型枚举。 */
export const entityTypeSchema = z.enum(["character", "faction", "location", "item"]);

/** 实体记录结构，对应 books/{bookId}/entities/index.json 中的条目。 */
export const bookEntityRecordSchema = z.object({
  id: z.string(),
  bookId: z.string(),
  entityType: entityTypeSchema,
  name: z.string(),
  role: z.string(),
  description: z.string(),
  fileId: z.string().nullable(),
  attributes: z.record(z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string()
});

/** 实体列表索引结构。 */
export const bookEntitiesIndexSchema = z.array(bookEntityRecordSchema);

/** 实体新建/更新入参：带 id 视为更新，否则新建；名称必填。 */
export const entityUpsertInputSchema = z.object({
  id: z.string().optional(),
  entityType: entityTypeSchema,
  name: z.string().trim().min(1, "名称不能为空"),
  role: z.string().trim().optional().default(""),
  description: z.string().optional().default(""),
  attributes: z.record(z.unknown()).optional().default({})
});

export type EntityUpsertInput = z.infer<typeof entityUpsertInputSchema>;

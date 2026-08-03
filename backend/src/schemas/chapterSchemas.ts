import { z } from "zod";
import { sceneTypeSchema } from "./styleVersionSchemas.js";

/**
 * 章节相关 Zod schema。
 * 覆盖章节记录落盘校验、创建/更新入参，以及 AI 续写任务的入参。
 */

/** 章节记录结构，与 books/{bookId}/chapters/index.json 中的条目对应。 */
export const chapterRecordSchema = z.object({
  id: z.string(),
  bookId: z.string(),
  volumeNo: z.number().int().positive(),
  chapterNo: z.number().int().positive(),
  title: z.string(),
  fileId: z.string(),
  wordCount: z.number().int().nonnegative(),
  status: z.enum(["planned", "drafting", "reviewed", "published"]),
  outline: z.string(),
  summary: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

/** 章节列表索引结构。 */
export const chaptersIndexSchema = z.array(chapterRecordSchema);

/** 新建章节入参：默认第 1 卷，未指定章节号时由服务端自动分配。 */
export const chapterCreateInputSchema = z.object({
  title: z.string().trim().optional().default("新章节"),
  volumeNo: z.number().int().positive().optional().default(1),
  chapterNo: z.number().int().positive().optional(),
  outline: z.string().optional().default(""),
  content: z.string().optional().default("")
});

/** 更新章节入参：全部可选，只提交需要修改的字段。 */
export const chapterUpdateInputSchema = z.object({
  title: z.string().trim().optional(),
  outline: z.string().optional(),
  summary: z.string().optional(),
  status: z.enum(["planned", "drafting", "reviewed", "published"]).optional(),
  content: z.string().optional()
});

/** AI 续写任务入参：instruction 为写作指令，sceneType 为场景类型（可 auto 推断）。 */
export const chapterAiTaskInputSchema = z.object({
  instruction: z.string().optional().default(""),
  selectedContextFileIds: z.array(z.string()).optional().default([]),
  sceneType: z.union([sceneTypeSchema, z.literal("auto")]).optional().default("auto"),
  allowDegradedStyle: z.boolean().optional().default(false)
});

import { z } from "zod";

/**
 * 作品相关 Zod schema。
 * 输入 schema 用于接口入参解析（带默认值，容忍前端少传字段）；Record schema 用于校验落盘 JSON。
 */

/** 作品状态枚举。 */
export const bookStatusSchema = z.enum(["planning", "drafting", "reviewing", "paused"]);

/**
 * 创建/更新作品的入参 schema。
 * 所有字段都有默认值或可空，前端可以先提交最小字段，再由 AI 初始化补齐设定。
 */
export const bookDraftInputSchema = z.object({
  title: z.string().trim().optional().default(""),
  genre: z.string().trim().optional().default(""),
  narrationPerspective: z.string().trim().optional().default(""),
  channel: z.string().trim().optional().default(""),
  writingStyleId: z.string().trim().nullable().optional().default(null),
  writingStyleVersionId: z.string().trim().nullable().optional().default(null),
  protagonistGender: z.string().trim().optional().default(""),
  protagonistName: z.string().trim().optional().default(""),
  plannedWords: z.number().int().positive().nullable().optional().default(null),
  chapterWords: z.number().int().positive().nullable().optional().default(null),
  brief: z.string().optional().default(""),
  worldFileName: z.string().trim().optional().default(""),
  worldFileContent: z.string().optional().default("")
});

/**
 * book.json 的结构校验。
 * 用户可以手动编辑本地 JSON，所以读取时必须校验，避免坏数据进入页面。
 */
export const bookRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  genre: z.string(),
  status: bookStatusSchema,
  narrationPerspective: z.string(),
  channel: z.string(),
  writingStyleId: z.string().nullable(),
  writingStyleVersionId: z.string().nullable().optional().default(null),
  protagonistGender: z.string(),
  protagonistName: z.string(),
  plannedWords: z.number().int().positive().nullable(),
  chapterWords: z.number().int().positive().nullable(),
  writtenWords: z.number().int().nonnegative(),
  writtenChapters: z.number().int().nonnegative(),
  currentChapterId: z.string().nullable(),
  worldFileId: z.string().nullable(),
  needsAiFill: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string()
});

/** books/{bookId}/book.json 数组索引结构。 */
export const booksIndexSchema = z.array(bookRecordSchema);

export type BookDraftInput = z.infer<typeof bookDraftInputSchema>;
export type BookRecordSchema = z.infer<typeof bookRecordSchema>;

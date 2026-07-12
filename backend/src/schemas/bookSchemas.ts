import { z } from "zod";

export const bookStatusSchema = z.enum(["planning", "drafting", "reviewing", "paused"]);

export const bookDraftInputSchema = z.object({
  title: z.string().trim().optional().default(""),
  genre: z.string().trim().optional().default(""),
  narrationPerspective: z.string().trim().optional().default(""),
  channel: z.string().trim().optional().default(""),
  writingStyleId: z.string().trim().nullable().optional().default(null),
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

export const booksIndexSchema = z.array(bookRecordSchema);

export type BookDraftInput = z.infer<typeof bookDraftInputSchema>;
export type BookRecordSchema = z.infer<typeof bookRecordSchema>;

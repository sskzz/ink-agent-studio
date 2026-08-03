import { z } from "zod";

/**
 * 作品文件相关 Zod schema。
 */

/** 文件类型枚举：决定文件用途与存盘位置（brief/outline/world/chapter 等）。 */
export const bookFileTypeSchema = z.enum([
  "brief",
  "outline",
  "world",
  "current_state",
  "foreshadowing",
  "chapter",
  "entity",
  "import"
]);

/** 文件记录结构，对应 books/{bookId}/files/index.json 中的条目。 */
export const bookFileRecordSchema = z.object({
  id: z.string(),
  bookId: z.string(),
  fileType: bookFileTypeSchema,
  title: z.string(),
  path: z.string(),
  summary: z.string(),
  contentHash: z.string().nullable(),
  parsedJson: z.any().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

/** 文件列表索引结构。 */
export const bookFilesIndexSchema = z.array(bookFileRecordSchema);

/** 更新文件内容入参：全量替换 content。 */
export const fileUpdateInputSchema = z.object({
  content: z.string()
});

/** 上传文件入参：fileName + content 必填，fileType 缺省按导入文件处理。 */
export const fileUploadInputSchema = z.object({
  fileName: z.string().trim().min(1),
  content: z.string(),
  fileType: bookFileTypeSchema.optional().default("import"),
  title: z.string().trim().optional().default("导入文件"),
  summary: z.string().trim().optional().default("")
});

export type BookFileRecordSchema = z.infer<typeof bookFileRecordSchema>;

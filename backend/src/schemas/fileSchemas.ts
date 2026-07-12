import { z } from "zod";

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

export const bookFilesIndexSchema = z.array(bookFileRecordSchema);

export const fileUpdateInputSchema = z.object({
  content: z.string()
});

export const fileUploadInputSchema = z.object({
  fileName: z.string().trim().min(1),
  content: z.string(),
  fileType: bookFileTypeSchema.optional().default("import"),
  title: z.string().trim().optional().default("导入文件"),
  summary: z.string().trim().optional().default("")
});

export type BookFileRecordSchema = z.infer<typeof bookFileRecordSchema>;

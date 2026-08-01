import { z } from "zod";
import { sceneTypeSchema } from "./styleVersionSchemas.js";

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

export const chaptersIndexSchema = z.array(chapterRecordSchema);

export const chapterCreateInputSchema = z.object({
  title: z.string().trim().optional().default("新章节"),
  volumeNo: z.number().int().positive().optional().default(1),
  chapterNo: z.number().int().positive().optional(),
  outline: z.string().optional().default(""),
  content: z.string().optional().default("")
});

export const chapterUpdateInputSchema = z.object({
  title: z.string().trim().optional(),
  outline: z.string().optional(),
  summary: z.string().optional(),
  status: z.enum(["planned", "drafting", "reviewed", "published"]).optional(),
  content: z.string().optional()
});

export const chapterAiTaskInputSchema = z.object({
  instruction: z.string().optional().default(""),
  selectedContextFileIds: z.array(z.string()).optional().default([]),
  sceneType: z.union([sceneTypeSchema, z.literal("auto")]).optional().default("auto"),
  allowDegradedStyle: z.boolean().optional().default(false)
});

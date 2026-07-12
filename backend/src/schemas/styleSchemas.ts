import { z } from "zod";

export const writingStyleRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string(),
  parameters: z.record(z.unknown()),
  sampleFileName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const writingStylesIndexSchema = z.array(writingStyleRecordSchema);

export const writingStyleCreateInputSchema = z.object({
  name: z.string().trim().min(1, "风格名称不能为空"),
  summary: z.string().optional().default(""),
  parameters: z.record(z.unknown()).optional().default({}),
  sampleFileName: z.string().nullable().optional().default(null)
});

export const styleAnalyzeInputSchema = z.object({
  name: z.string().trim().optional().default("AI 分析风格"),
  sampleFileName: z.string().trim().optional().default("sample.md"),
  content: z.string().min(1, "模板作品内容不能为空")
});

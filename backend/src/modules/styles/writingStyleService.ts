import { randomUUID } from "node:crypto";
import {
  styleAnalyzeInputSchema,
  writingStyleCreateInputSchema,
  writingStylesIndexSchema
} from "../../schemas/styleSchemas.js";
import { readJsonFile, writeJsonFile } from "../../utils/jsonStore.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";

async function readStyles(workspacePaths: WorkspacePaths) {
  return readJsonFile(workspacePaths.writingStylesFile, writingStylesIndexSchema, []);
}

async function writeStyles(workspacePaths: WorkspacePaths, styles: Awaited<ReturnType<typeof readStyles>>) {
  await writeJsonFile(workspacePaths.writingStylesFile, styles);
}

export async function listWritingStyles(workspacePaths: WorkspacePaths) {
  return readStyles(workspacePaths);
}

export async function createWritingStyle(workspacePaths: WorkspacePaths, body: unknown) {
  const input = writingStyleCreateInputSchema.parse(body);
  const now = new Date().toISOString();
  const style = {
    id: randomUUID(),
    name: input.name,
    summary: input.summary,
    parameters: input.parameters,
    sampleFileName: input.sampleFileName,
    createdAt: now,
    updatedAt: now
  };
  const styles = await readStyles(workspacePaths);
  await writeStyles(workspacePaths, [style, ...styles]);
  return style;
}

export async function analyzeWritingStyle(_workspacePaths: WorkspacePaths, body: unknown) {
  const input = styleAnalyzeInputSchema.parse(body);
  const lines = input.content.split(/\r?\n/).filter((line) => line.trim());
  const averageLineLength =
    lines.length > 0 ? Math.round(lines.reduce((sum, line) => sum + line.length, 0) / lines.length) : 0;
  const dialogueRatio =
    lines.length > 0 ? lines.filter((line) => /["“”]/.test(line)).length / lines.length : 0;
  const now = new Date().toISOString();

  // 分析接口只返回预览结果，不直接写入风格库。
  // 用户点击“保存风格”后，前端再调用 createWritingStyle 持久化，避免误保存和重复记录。
  return {
    id: `analysis-${randomUUID()}`,
    name: input.name,
    summary: `基于 ${input.sampleFileName} 模拟分析生成，平均行长约 ${averageLineLength} 字。`,
    sampleFileName: input.sampleFileName,
    parameters: {
      averageLineLength,
      dialogueRatio,
      paragraphCount: lines.length,
      rhythm: averageLineLength > 42 ? "长句铺陈" : "短句推进",
      note: "当前为确定性分析预览，保存后才会写入本地风格库。"
    },
    createdAt: now,
    updatedAt: now
  };
}

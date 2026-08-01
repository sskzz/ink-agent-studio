import type { z } from "zod";
import type { writingStyleRecordSchema } from "../../schemas/styleSchemas.js";
import { sanitizeStyleConstraint } from "./styleConstraintSanitizer.js";

type WritingStyleRecord = z.infer<typeof writingStyleRecordSchema>;

export interface CompiledWritingStyleConstraints {
  styleId: string;
  styleName: string;
  generationPrompt: string;
  reviewPrompt: string;
  confidence: number | null;
}

/**
 * 将完整风格资产压缩成写作和审稿模型可直接使用的短约束，避免每章重复注入分析证据和解释。
 */
export function compileWritingStyleConstraints(style: WritingStyleRecord): CompiledWritingStyleConstraints {
  const analysis = style.analysis;
  const fallbackParameters = Object.entries(style.parameters)
    .filter(([, value]) => typeof value === "string" && value.trim())
    .slice(0, 6)
    .map(([key, value]) => sanitizeStyleConstraint(`${key}：${String(value).trim()}`, 120))
    .filter(Boolean);

  const mustKeep = analysis?.styleBoundaries.mustKeep ?? [];
  const executableRules = analysis
    ? Object.values(analysis.executableRules)
        .flat()
        .sort((left, right) => left.priority - right.priority)
        .map((item) => item.rule)
    : [];
  const generationPrompt = compactConstraint(
    [
      analysis?.stylePromptSnippet,
      style.summary,
      mustKeep.length ? `必须保持：${mustKeep.join("、")}` : "",
      ...executableRules,
      ...fallbackParameters
    ],
    350
  );
  const reviewPrompt = compactConstraint(
    [
      analysis?.reviewPromptSnippet,
      mustKeep.length ? `不得破坏：${mustKeep.join("、")}` : "",
      generationPrompt
    ],
    500
  );

  return {
    styleId: style.id,
    styleName: style.name,
    generationPrompt: generationPrompt || `保持「${style.name}」写作风格。`,
    reviewPrompt: reviewPrompt || `检查正文是否保持「${style.name}」写作风格。`,
    confidence: analysis?.parameters.confidence ?? null
  };
}

function compactConstraint(parts: Array<string | undefined>, maxLength: number) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of parts) {
    const normalized = part ? sanitizeStyleConstraint(part) : "";
    if (!normalized || seen.has(normalized)) continue;
    const candidate = [...result, normalized].join("；");
    if (candidate.length > maxLength) break;
    seen.add(normalized);
    result.push(normalized);
  }

  return result.join("；");
}

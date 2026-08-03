/**
 * 风格约束编译器（V1）。
 * 职责：将完整的写作风格记录（analysis + parameters）压缩成写作与审稿模型可用的短 Prompt 文本；
 * 边界：只做纯函数式文本转换，不读写磁盘，不依赖模型调用；版本化的完整约束编译请走 writingStyleConstraintCompilerV2。
 */
import type { z } from "zod";
import type { writingStyleRecordSchema } from "../../schemas/styleSchemas.js";
import { sanitizeStyleConstraint } from "./styleConstraintSanitizer.js";

type WritingStyleRecord = z.infer<typeof writingStyleRecordSchema>;

/** 编译产物：写作/审稿两套 Prompt 及其置信度，供模型调用方直接注入。 */
export interface CompiledWritingStyleConstraints {
  styleId: string;
  styleName: string;
  generationPrompt: string;
  reviewPrompt: string;
  confidence: number | null;
}

/**
 * 将完整风格资产压缩成写作和审稿模型可直接使用的短约束，避免每章重复注入分析证据和解释。
 * @param style 完整写作风格记录
 * @returns 编译后的约束对象；约束为空时回退为「保持风格」的兜底提示
 */
export function compileWritingStyleConstraints(style: WritingStyleRecord): CompiledWritingStyleConstraints {
  const analysis = style.analysis;
  // 参数兜底：只取非空字符串参数，最多 6 条，每条截断到 120 字，防止生成 Prompt 被用户随意填写的参数撑爆
  const fallbackParameters = Object.entries(style.parameters)
    .filter(([, value]) => typeof value === "string" && value.trim())
    .slice(0, 6)
    .map(([key, value]) => sanitizeStyleConstraint(`${key}：${String(value).trim()}`, 120))
    .filter(Boolean);

  const mustKeep = analysis?.styleBoundaries.mustKeep ?? [];
  // 可执行规则按优先级升序排布，低优先级在前，保证高优先级规则在压缩时优先保留
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
  // 去重 + 超长截断：候选文本拼接超限则停止追加，保证返回内容严格不超过 maxLength
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

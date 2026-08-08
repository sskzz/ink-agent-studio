/**
 * 审稿结果聚合器。
 * 职责：把三路审查（本地风格度量、本地反 AI 规则、模型语义审查）合并为一份最终审稿结论，并生成重写指令；
 * 边界：纯函数；语义审查不可用时明确返回 unavailable，不能用本地正则分数冒充完整质量通过；合并分数按「多稳定样本」加权语义审查占比。
 */
import type { WritingStyleComplianceReport } from "../styles/writingStyleCompliance.js";
import type { SemanticStyleReview } from "./semanticStyleReviewer.js";
import type { AntiAiLocalReview } from "./antiAi/antiAiLocalReviewer.js";

/** 合并后的审稿结论：passed 为最终闸门，hardFailures 是不容协商的硬违规。 */
export interface CombinedStyleReview {
  verificationStatus: "passed" | "failed" | "unavailable";
  passed: boolean;
  score: number | null;
  localReview: WritingStyleComplianceReport | null;
  antiAiReview: AntiAiLocalReview | null;
  semanticReview: SemanticStyleReview | null;
  hardFailures: string[];
  degraded: boolean;
  degradedReasons: string[];
}

/**
 * 合并三路审查结论。
 * @param input.local 本地风格度量结果（可能为 null：未绑定风格/无版本）
 * @param input.antiAi 本地反 AI 规则结果
 * @param input.semantic 模型语义审查结果（可能为 null：模型不可用）
 * @param input.stableMultiSample 是否有 >=3 篇稳定样本（决定本地结论在总分中的权重）
 * @param input.invariantRuleIds 风格不可变规则 id 集合（其违规视为硬违规）
 */
export function combineStyleReviews(input: {
  local: WritingStyleComplianceReport | null;
  antiAi?: AntiAiLocalReview | null;
  semantic: SemanticStyleReview | null;
  semanticDegradedReason?: string | null;
  stableMultiSample: boolean;
  invariantRuleIds?: string[];
}): CombinedStyleReview {
  // 硬违规：语义层的人称/距离/连续性违规与不可变规则违规、反 AI 层的 hard 违规；任一存在即 overall 失败
  // 宽容校验后 violation 字段可为空：按"无硬违规"容错处理，避免审稿整体降级
  const semanticHardFailures = (input.semantic?.violations ?? [])
    .filter((item) => item.severity === "high"
      && ((item.category && ["viewpoint", "distance", "continuity"].includes(item.category))
        || (item.ruleId && input.invariantRuleIds?.includes(item.ruleId))))
    .map((item) => `${item.category ?? "未知类别"}：${item.reason ?? "无说明"}`);
  const antiAiHardFailures = (input.antiAi?.violations ?? [])
    .filter((item) => item.hard)
    .map((item) => `${item.category}：${item.reason}`);
  const hardFailures = [...new Set([...semanticHardFailures, ...antiAiHardFailures])];
  const localScores = [input.local?.score, input.antiAi?.score].filter((value): value is number => value !== null && value !== undefined);
  const localScore = localScores.length ? localScores.reduce((sum, value) => sum + value, 0) / localScores.length : null;
  const semanticScore = input.semantic?.score;
  const semanticUnavailable = input.semantic === null;
  let score: number | null = null;
  // 合并分数：两路都有分时加权平均——本地结论可信度随稳定样本数提升（0.25 → 0.4）
  if (!semanticUnavailable && localScore !== null && localScore !== undefined && semanticScore !== null && semanticScore !== undefined) {
    const localWeight = input.stableMultiSample ? 0.4 : 0.25;
    score = Math.round(localScore * localWeight + semanticScore * (1 - localWeight));
  } else if (!semanticUnavailable && semanticScore !== null && semanticScore !== undefined) score = semanticScore;
  const degradedReasons = input.semanticDegradedReason
    ? [input.semanticDegradedReason]
    : semanticUnavailable
      ? ["语义审查未返回可验证结果。"]
      : [];
  const passed = !semanticUnavailable
    && hardFailures.length === 0
    && score !== null
    && score >= 70
    && (input.local?.passed ?? true)
    && (input.antiAi?.passed ?? true)
    && input.semantic?.passed === true;
  return {
    verificationStatus: semanticUnavailable ? "unavailable" : passed ? "passed" : "failed",
    passed,
    score,
    localReview: input.local,
    antiAiReview: input.antiAi ?? null,
    semanticReview: input.semantic,
    hardFailures,
    degraded: degradedReasons.length > 0,
    degradedReasons
  };
}

/** 把三路违规合成给模型/用户的分步重写指令；hardFailures 最先列出，low 级违规一律过滤。 */
export function buildCombinedRevisionInstruction(review: CombinedStyleReview) {
  const local = review.localReview?.violations
    .filter((item) => item.severity !== "low")
    .map((item) => `${item.label}：${item.rewriteHint}`) ?? [];
  const semantic = review.semanticReview?.violations
    .filter((item) => item.severity !== "low" && item.reason?.trim() && item.rewriteHint?.trim())
    .map((item) => `${item.category ?? "语义质量"}：${item.reason!.trim()}；${item.rewriteHint!.trim()}`) ?? [];
  const antiAi = review.antiAiReview?.violations
    .filter((item) => item.severity !== "low")
    .map((item) => `${item.category}：${item.reason}；${item.rewriteHint}`) ?? [];
  return [...new Set([...review.hardFailures, ...antiAi, ...local, ...semantic])].map((item, index) => `${index + 1}. ${item}`).join("\n");
}

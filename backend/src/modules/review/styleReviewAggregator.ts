/**
 * 审稿结果聚合器。
 * 职责：把三路审查（本地风格度量、本地反 AI 规则、模型语义审查）合并为一份最终审稿结论，并生成重写指令；
 * 边界：纯函数；语义审查降级（degraded）时不会让整体失败，只记录降级原因；合并分数按「多稳定样本」加权语义审查占比。
 */
import type { WritingStyleComplianceReport } from "../styles/writingStyleCompliance.js";
import type { SemanticStyleReview } from "./semanticStyleReviewer.js";
import type { AntiAiLocalReview } from "./antiAi/antiAiLocalReviewer.js";

/** 合并后的审稿结论：passed 为最终闸门，hardFailures 是不容协商的硬违规。 */
export interface CombinedStyleReview {
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
  const semanticHardFailures = (input.semantic?.violations ?? [])
    .filter((item) => item.severity === "high" && (["viewpoint", "distance", "continuity"].includes(item.category) || input.invariantRuleIds?.includes(item.ruleId)))
    .map((item) => `${item.category}：${item.reason}`);
  const antiAiHardFailures = (input.antiAi?.violations ?? [])
    .filter((item) => item.hard)
    .map((item) => `${item.category}：${item.reason}`);
  const hardFailures = [...new Set([...semanticHardFailures, ...antiAiHardFailures])];
  const localScores = [input.local?.score, input.antiAi?.score].filter((value): value is number => value !== null && value !== undefined);
  const localScore = localScores.length ? localScores.reduce((sum, value) => sum + value, 0) / localScores.length : null;
  const semanticScore = input.semantic?.score;
  let score: number | null = null;
  // 合并分数：两路都有分时加权平均——本地结论可信度随稳定样本数提升（0.25 → 0.4）
  if (localScore !== null && localScore !== undefined && semanticScore !== null && semanticScore !== undefined) {
    const localWeight = input.stableMultiSample ? 0.4 : 0.25;
    score = Math.round(localScore * localWeight + semanticScore * (1 - localWeight));
  } else if (semanticScore !== null && semanticScore !== undefined) score = semanticScore;
  else if (localScore !== null && localScore !== undefined) score = localScore;
  const degradedReasons = input.semanticDegradedReason ? [input.semanticDegradedReason] : [];
  return {
    passed: hardFailures.length === 0 && (score === null || score >= 70) && (input.local?.passed ?? true) && (input.antiAi?.passed ?? true) && (input.semantic?.passed ?? true),
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
    .filter((item) => item.severity !== "low")
    .map((item) => `${item.category}：${item.reason}；${item.rewriteHint}`) ?? [];
  const antiAi = review.antiAiReview?.violations
    .filter((item) => item.severity !== "low")
    .map((item) => `${item.category}：${item.reason}；${item.rewriteHint}`) ?? [];
  return [...new Set([...review.hardFailures, ...antiAi, ...local, ...semantic])].map((item, index) => `${index + 1}. ${item}`).join("\n");
}

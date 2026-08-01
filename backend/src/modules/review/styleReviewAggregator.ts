import type { WritingStyleComplianceReport } from "../styles/writingStyleCompliance.js";
import type { SemanticStyleReview } from "./semanticStyleReviewer.js";
import type { AntiAiLocalReview } from "./antiAi/antiAiLocalReviewer.js";

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

export function combineStyleReviews(input: {
  local: WritingStyleComplianceReport | null;
  antiAi?: AntiAiLocalReview | null;
  semantic: SemanticStyleReview | null;
  semanticDegradedReason?: string | null;
  stableMultiSample: boolean;
  invariantRuleIds?: string[];
}): CombinedStyleReview {
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

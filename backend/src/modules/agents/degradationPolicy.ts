export type DegradationCode =
  | "STYLE_VERSION_FALLBACK"
  | "INSUFFICIENT_STYLE_SAMPLES"
  | "SCENE_CLASSIFIER_FALLBACK"
  | "SEMANTIC_REVIEW_UNAVAILABLE"
  | "LOCAL_REVIEW_UNAVAILABLE"
  | "REVISION_FAILED";

export interface DegradationReason {
  code: DegradationCode;
  message: string;
  recoverable: boolean;
}

export function degradationReason(code: DegradationCode, message: string, recoverable = true): DegradationReason {
  return { code, message, recoverable };
}

export function collectDegradationReasons(input: {
  versionFallback?: string | null;
  validSampleCount?: number;
  sceneSource?: string;
  semanticReviewFailure?: string | null;
}) {
  const reasons: DegradationReason[] = [];
  if (input.versionFallback) reasons.push(degradationReason("STYLE_VERSION_FALLBACK", input.versionFallback));
  if (input.validSampleCount !== undefined && input.validSampleCount < 3) reasons.push(degradationReason("INSUFFICIENT_STYLE_SAMPLES", "有效风格样本少于 3 篇，统计指标已降为软约束。"));
  if (input.sceneSource === "heuristic") reasons.push(degradationReason("SCENE_CLASSIFIER_FALLBACK", "场景由本地规则识别。"));
  if (input.semanticReviewFailure) reasons.push(degradationReason("SEMANTIC_REVIEW_UNAVAILABLE", input.semanticReviewFailure));
  return reasons;
}

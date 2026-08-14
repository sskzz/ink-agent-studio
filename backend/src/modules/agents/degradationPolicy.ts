/** 降级原因码（文件职责）：标识写作/审稿链路中哪些能力被降级，供前端与审计使用。 */
export type DegradationCode =
  | "STYLE_VERSION_FALLBACK"
  | "INSUFFICIENT_STYLE_SAMPLES"
  | "SCENE_CLASSIFIER_FALLBACK"
  | "SEMANTIC_REVIEW_UNAVAILABLE"
  | "LOCAL_REVIEW_UNAVAILABLE"
  | "REVISION_FAILED"
  | "KNOWLEDGE_REVISION_FAILED"
  | "KNOWLEDGE_AUDIT_BLOCKED"
  | "KNOWLEDGE_SEMANTIC_AUDIT_DEGRADED"
  | "KNOWLEDGE_SEMANTIC_AUDIT_BLOCKED";

/** 单条降级说明：原因码 + 面向用户的中文描述 + 是否可恢复（软降级）。 */
export interface DegradationReason {
  code: DegradationCode;
  message: string;
  recoverable: boolean;
}

/**
 * 构造一条降级原因。
 * 入参：code——原因码；message——描述；recoverable——默认 true（软约束降级，不影响写入）。
 */
export function degradationReason(code: DegradationCode, message: string, recoverable = true): DegradationReason {
  return { code, message, recoverable };
}

/**
 * 收集本轮生成的降级原因列表。
 * 入参：版本回退信息、有效样本数、场景识别来源、语义审稿失败信息。
 * 返回值：非空说明对应能力被降级；空数组说明链路完整可用。
 * 业务原因：风格样本不足或语义审稿不可用时，硬约束应降为软约束，避免阻塞正文生成。
 */
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

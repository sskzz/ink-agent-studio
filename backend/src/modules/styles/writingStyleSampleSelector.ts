/**
 * 样本选择器。
 * 职责：把样本划分为 可接受（accepted）/ 弱证据（weak）/ 拒绝（rejected）三档，供版本重建时决定哪些样本能形成不可变规则；
 * 边界：纯函数；判据为质量规则、内容类型、质量权重与初步聚合的离群命中率；弱样本只能参与次要/场景化特征。
 */
import type { AggregateStyleProfile, WritingStyleSample } from "../../schemas/styleVersionSchemas.js";
import { resolveWritingStyleSampleStatus } from "./writingStyleSampleQuality.js";

/** 样本分档结果；reasons 记录每个样本被分档的原因（去重后）。 */
export interface StyleSampleSelection {
  accepted: WritingStyleSample[];
  weak: WritingStyleSample[];
  rejected: WritingStyleSample[];
  reasons: Record<string, string[]>;
}

/**
 * 对样本分档。
 * @param samples 全部样本
 * @param preliminaryAggregate 可选：初步聚合画像（用于离群判定），缺省时不做离群检查
 * @returns 三档样本列表与原因
 */
export function selectWritingStyleSamples(
  samples: WritingStyleSample[],
  preliminaryAggregate?: AggregateStyleProfile
): StyleSampleSelection {
  const accepted: WritingStyleSample[] = [];
  const weak: WritingStyleSample[] = [];
  const rejected: WritingStyleSample[] = [];
  const reasons: Record<string, string[]> = {};
  // 统计每个样本在多少比例的度量上被判定为离群
  const outlierCounts = new Map<string, number>();
  const metricCount = Object.keys(preliminaryAggregate?.metrics ?? {}).length;
  for (const metric of Object.values(preliminaryAggregate?.metrics ?? {})) {
    for (const id of metric.outlierSampleIds) outlierCounts.set(id, (outlierCounts.get(id) ?? 0) + 1);
  }

  for (const sample of samples) {
    const sampleReasons = [...sample.quality.warnings];
    const qualityStatus = resolveWritingStyleSampleStatus(sample.quality);
    // 分档逻辑：质量不可用 → 拒绝；权重过低 / 内容类型是大纲元数据 / 超过 30% 度量离群 → 降为弱证据；其余才可形成不可变规则
    if (qualityStatus === "rejected") {
      sampleReasons.push("样本质量规则判定为不可用。");
      rejected.push(sample);
    } else if (qualityStatus === "weak" || (
      sample.quality.weight < 0.5
      || ["outline", "metadata", "unknown"].includes(sample.quality.detectedContentType)
      || (metricCount > 0 && (outlierCounts.get(sample.id) ?? 0) / metricCount > 0.3)
    )) {
      sampleReasons.push("样本只能作为次要语义证据，不得形成不可变规则。");
      weak.push(sample);
    } else {
      accepted.push(sample);
    }
    reasons[sample.id] = [...new Set(sampleReasons)];
  }
  return { accepted, weak, rejected, reasons };
}

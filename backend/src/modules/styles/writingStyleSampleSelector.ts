import type { AggregateStyleProfile, WritingStyleSample } from "../../schemas/styleVersionSchemas.js";

export interface StyleSampleSelection {
  accepted: WritingStyleSample[];
  weak: WritingStyleSample[];
  rejected: WritingStyleSample[];
  reasons: Record<string, string[]>;
}

export function selectWritingStyleSamples(
  samples: WritingStyleSample[],
  preliminaryAggregate?: AggregateStyleProfile
): StyleSampleSelection {
  const accepted: WritingStyleSample[] = [];
  const weak: WritingStyleSample[] = [];
  const rejected: WritingStyleSample[] = [];
  const reasons: Record<string, string[]> = {};
  const outlierCounts = new Map<string, number>();
  const metricCount = Object.keys(preliminaryAggregate?.metrics ?? {}).length;
  for (const metric of Object.values(preliminaryAggregate?.metrics ?? {})) {
    for (const id of metric.outlierSampleIds) outlierCounts.set(id, (outlierCounts.get(id) ?? 0) + 1);
  }

  for (const sample of samples) {
    const sampleReasons = [...sample.quality.warnings];
    if (!sample.quality.usable) {
      sampleReasons.push("样本质量规则判定为不可用。");
      rejected.push(sample);
    } else if (
      sample.quality.weight < 0.5
      || ["outline", "metadata", "unknown"].includes(sample.quality.detectedContentType)
      || (metricCount > 0 && (outlierCounts.get(sample.id) ?? 0) / metricCount > 0.3)
    ) {
      sampleReasons.push("样本只能作为次要语义证据，不得形成不可变规则。");
      weak.push(sample);
    } else {
      accepted.push(sample);
    }
    reasons[sample.id] = [...new Set(sampleReasons)];
  }
  return { accepted, weak, rejected, reasons };
}

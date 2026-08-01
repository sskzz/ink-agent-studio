import type { AggregateStyleProfile, WritingStyleSample } from "../../schemas/styleVersionSchemas.js";

export function aggregateWritingStyleSamples(samples: WritingStyleSample[]): AggregateStyleProfile {
  const validSamples = samples.filter((sample) => sample.quality.usable);
  const metricKeys = [...new Set(validSamples.flatMap((sample) => Object.keys(sample.featureProfile.metrics)))];
  const metrics: AggregateStyleProfile["metrics"] = {};

  for (const metric of metricKeys) {
    const observations = validSamples
      .map((sample) => ({ sampleId: sample.id, value: sample.featureProfile.metrics[metric], weight: sample.quality.weight }))
      .filter((item): item is { sampleId: string; value: number; weight: number } => Number.isFinite(item.value));
    if (!observations.length) continue;
    const values = observations.map((item) => item.value).sort((a, b) => a - b);
    const center = median(values);
    const deviations = values.map((value) => Math.abs(value - center));
    const mad = median([...deviations].sort((a, b) => a - b));
    const outlierThreshold = Math.max(mad * 3.5, minimumTolerance(metric));
    const accepted = observations.filter((item) => Math.abs(item.value - center) <= outlierThreshold || observations.length < 4);
    const acceptedValues = accepted.map((item) => item.value);
    const weightedMean = weightedAverage(accepted);
    const standardDeviation = stdDev(acceptedValues);
    const spread = Math.max(mad * 2.5, standardDeviation, minimumTolerance(metric));
    const averageWeight = accepted.reduce((sum, item) => sum + item.weight, 0) / Math.max(accepted.length, 1);
    const consistency = 1 / (1 + standardDeviation / Math.max(Math.abs(center), minimumTolerance(metric)));
    const coverage = Math.min(1, accepted.length / 3);
    metrics[metric] = {
      metric,
      weightedMean: round(weightedMean),
      median: round(center),
      standardDeviation: round(standardDeviation),
      mad: round(mad),
      preferredMin: round(Math.max(0, center - spread)),
      preferredMax: round(center + spread),
      stability: round(Math.min(1, coverage * consistency * averageWeight)),
      validSampleCount: accepted.length,
      outlierSampleIds: observations.filter((item) => !accepted.includes(item)).map((item) => item.sampleId)
    };
  }

  const stabilityValues = Object.values(metrics).map((metric) => metric.stability);
  const averageStability = stabilityValues.length ? stabilityValues.reduce((sum, value) => sum + value, 0) / stabilityValues.length : 0;
  const quality = validSamples.length
    ? validSamples.reduce((sum, sample) => sum + sample.quality.weight, 0) / validSamples.length
    : 0;
  const confidence = Math.round(Math.min(100, Math.min(1, validSamples.length / 3) * 35 + averageStability * 40 + quality * 25));
  const warnings: string[] = [];
  if (validSamples.length < 3) warnings.push("有效样本少于 3 篇，统计指标只能作为软约束。");
  if (samples.some((sample) => !sample.quality.usable)) warnings.push("部分样本质量不足，未参与稳定画像计算。");
  return {
    schemaVersion: "style-aggregate.v1",
    sampleCount: samples.length,
    validSampleCount: validSamples.length,
    totalContentLength: validSamples.reduce((sum, sample) => sum + sample.contentLength, 0),
    confidence,
    status: confidence >= 70 && validSamples.length >= 3 ? "stable" : confidence >= 40 ? "usable" : "degraded",
    metrics,
    acceptedSampleIds: validSamples.map((sample) => sample.id),
    weakSampleIds: [],
    rejectedSampleIds: samples.filter((sample) => !sample.quality.usable).map((sample) => sample.id),
    warnings
  };
}

function weightedAverage(items: Array<{ value: number; weight: number }>) {
  const weight = items.reduce((sum, item) => sum + item.weight, 0);
  return weight ? items.reduce((sum, item) => sum + item.value * item.weight, 0) / weight : 0;
}
function median(values: number[]) { const middle = Math.floor(values.length / 2); return values.length % 2 ? values[middle]! : ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2; }
function stdDev(values: number[]) { if (!values.length) return 0; const mean = values.reduce((sum, value) => sum + value, 0) / values.length; return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length); }
function minimumTolerance(metric: string) { return metric.toLowerCase().includes("ratio") ? 0.08 : metric.toLowerCase().includes("density") ? 1.5 : 3; }
function round(value: number) { return Math.round(value * 100) / 100; }

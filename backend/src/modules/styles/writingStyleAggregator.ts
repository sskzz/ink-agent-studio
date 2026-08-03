/**
 * 风格样本聚合器。
 * 职责：把多篇可用样本的特征指标聚合成稳定的风格画像（中心值、区间、稳定度、置信度、状态）；
 * 边界：纯函数；只处理可用样本，异常值用 MAD 离群检测剔除；产出稳定度不足的度量在编译阶段会被降级为软约束。
 */
import type { AggregateStyleProfile, WritingStyleSample } from "../../schemas/styleVersionSchemas.js";

/**
 * 聚合多篇样本为一份风格画像。
 * @param samples 全部风格样本（含质量不合格的）
 * @returns 聚合画像；每项度量带 preferredMin/Max 区间、稳定度与离群样本列表
 */
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
    // MAD 离群检测：偏差超过 3.5 倍 MAD 视为离群样本剔除；
    // 样本不足 4 篇时不剔除（统计量太少，剔除反而丢失信息）
    const outlierThreshold = Math.max(mad * 3.5, minimumTolerance(metric));
    const accepted = observations.filter((item) => Math.abs(item.value - center) <= outlierThreshold || observations.length < 4);
    const acceptedValues = accepted.map((item) => item.value);
    const weightedMean = weightedAverage(accepted);
    const standardDeviation = stdDev(acceptedValues);
    // 区间以 MAD 与标准差中较大者铺开：MAD 抗离群、标准差反映真实散布，取大者避免区间过窄
    const spread = Math.max(mad * 2.5, standardDeviation, minimumTolerance(metric));
    // 稳定性 = 一致性(离散度) × 覆盖率(样本数/3) × 平均权重；三项相乘保证任何一项不足都会压低稳定度
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
  // 置信度权重设计：样本数量（最多 35 分）+ 平均稳定度（40 分）+ 样本质量（25 分）
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

/** 加权平均：权重总和为 0（全部零权重）时回退为 0，避免除零 */
function weightedAverage(items: Array<{ value: number; weight: number }>) {
  const weight = items.reduce((sum, item) => sum + item.weight, 0);
  return weight ? items.reduce((sum, item) => sum + item.value * item.weight, 0) / weight : 0;
}
/** 中位数：偶数个数时取中间两数平均 */
function median(values: number[]) { const middle = Math.floor(values.length / 2); return values.length % 2 ? values[middle]! : ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2; }
/** 总体标准差 */
function stdDev(values: number[]) { if (!values.length) return 0; const mean = values.reduce((sum, value) => sum + value, 0) / values.length; return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length); }
/** 各度量类型的最小统计容差：比例类 0.08、密度类 1.5、其余（句长等）3，防止离群阈值过小 */
function minimumTolerance(metric: string) { return metric.toLowerCase().includes("ratio") ? 0.08 : metric.toLowerCase().includes("density") ? 1.5 : 3; }
function round(value: number) { return Math.round(value * 100) / 100; }

/**
 * 风格符合度评估。
 * 职责：把生成正文的特征指标与风格画像（或编译后的度量目标区间）对比，产出违规清单、评分与重写建议；
 * 边界：纯函数不读写文件；短文本/无目标指标时返回 skipped（不误伤正常短段落）；只做量化评估，语义层面的审查在 review 模块。
 */
import type { WritingStyleFeatureProfile } from "../../schemas/styleSchemas.js";
import { extractWritingStyleFeatures } from "./writingStyleFeatures.js";

/** 单条度量违规：超出期望区间的幅度、严重度与重写提示。 */
export interface StyleMetricViolation {
  metric: string;
  label: string;
  expectedMin: number;
  expectedMax: number;
  actual: number;
  severity: "low" | "medium" | "high";
  rewriteHint: string;
}

/** 风格符合度报告：passed 决定是否触发自动修订，skipped 表示样本或正文不足未评估。 */
export interface WritingStyleComplianceReport {
  passed: boolean;
  skipped: boolean;
  score: number | null;
  sourceContentLength: number;
  generatedContentLength: number;
  violations: StyleMetricViolation[];
  warnings: string[];
}

/** 编译版度量目标：带稳定度的中心值与可接受区间。 */
export interface CompiledMetricTarget {
  min: number;
  max: number;
  target: number;
  stability: number;
}

/** 单条度量的评估策略：绝对/相对容差、区间模式（upper-risk 只约束上限，防止过度模板化/解释化）。 */
interface MetricPolicy {
  key: string;
  label: string;
  absoluteTolerance?: number;
  relativeTolerance?: number;
  mode?: "range" | "upper-risk";
  rewriteHint: string;
}

/** 各度量的容差与重写提示；upper-risk 模式只防超标，不惩罚低于目标（如因果解释过少不算违规）。 */
const policies: MetricPolicy[] = [
  { key: "averageSentenceLength", label: "平均句长", relativeTolerance: 0.4, absoluteTolerance: 4, rewriteHint: "调整句子拆分与合并，使整体句长接近样本。" },
  { key: "sentenceLengthStdDev", label: "句长波动", relativeTolerance: 0.6, absoluteTolerance: 4, rewriteHint: "调整长短句组合，避免节奏过于单一。" },
  { key: "shortSentenceRatio", label: "短句比例", absoluteTolerance: 0.2, rewriteHint: "按样本节奏增减十五字以内的短句。" },
  { key: "longSentenceRatio", label: "长句比例", absoluteTolerance: 0.14, rewriteHint: "按样本节奏调整四十字以上长句数量。" },
  { key: "sentenceLengthTransitionRatio", label: "长短句切换", absoluteTolerance: 0.22, rewriteHint: "调整相邻句子的长度变化，恢复样本的节奏起伏。" },
  { key: "averageLineLength", label: "平均段落长度", relativeTolerance: 0.45, absoluteTolerance: 8, rewriteHint: "拆分或合并段落，使段落密度接近样本。" },
  { key: "independentShortParagraphRatio", label: "独立短段比例", absoluteTolerance: 0.22, rewriteHint: "按样本习惯调整独立短段和停顿。" },
  { key: "dialogueCharacterRatio", label: "对白字符占比", absoluteTolerance: 0.18, rewriteHint: "调整对白与叙述的占比，但不要改变剧情事实。" },
  { key: "actionWordDensity", label: "动作描写密度", relativeTolerance: 0.8, absoluteTolerance: 2.5, rewriteHint: "通过可观察动作调整叙事推进密度。" },
  { key: "psychologyWordDensity", label: "心理表达密度", relativeTolerance: 0.8, absoluteTolerance: 2.5, rewriteHint: "减少或补充心理说明，优先保持原风格的呈现方式。" },
  { key: "causalExplanationDensity", label: "因果解释密度", relativeTolerance: 1, absoluteTolerance: 2, mode: "upper-risk", rewriteHint: "删除过满的因果解释，改用动作、对白或细节呈现。" },
  { key: "templatePatternDensity", label: "模板句式密度", relativeTolerance: 1, absoluteTolerance: 1.5, mode: "upper-risk", rewriteHint: "打散重复的模板句式，保留自然停顿和具体细节。" },
  { key: "paragraphSummaryCandidateRatio", label: "段尾总结候选", absoluteTolerance: 0.12, mode: "upper-risk", rewriteHint: "删除抽象段尾总结，改用动作、对白或环境反馈收束。" }
];

/** 用宽容区间比较单样本风格画像；短文本或低质量样本只返回跳过状态，不触发自动修订。
 * @param content 生成正文
 * @param profile 单样本风格画像
 * @returns 符合度报告；样本 <300 字或正文 <120 字时 skipped，避免小段落误判
 */
export function evaluateWritingStyleCompliance(
  content: string,
  profile: WritingStyleFeatureProfile
): WritingStyleComplianceReport {
  const generatedLength = content.replace(/\s+/g, "").length;
  // 样本与正文过短时统计不可靠：直接跳过量化检查，防止短段落被误改
  if (profile.sourceContentLength < 300 || generatedLength < 120) {
    return {
      passed: true,
      skipped: true,
      score: null,
      sourceContentLength: profile.sourceContentLength,
      generatedContentLength: generatedLength,
      violations: [],
      warnings: [profile.sourceContentLength < 300 ? "风格样本少于 300 字，未执行量化约束。" : "生成正文少于 120 字，未执行量化约束。"]
    };
  }

  const { localStats } = extractWritingStyleFeatures(content, "generated.md");
  const actualMetrics = localStats as unknown as Record<string, number>;
  const violations: StyleMetricViolation[] = [];

  for (const policy of policies) {
    const target = profile.metrics[policy.key];
    const actual = actualMetrics[policy.key];
    if (!Number.isFinite(target) || !Number.isFinite(actual)) continue;
    // 容差取相对与绝对两者较大值，度量值越大允许的波动越大
    const tolerance = Math.max(policy.absoluteTolerance ?? 0, Math.abs(target) * (policy.relativeTolerance ?? 0));
    // upper-risk 模式（模板句、因果解释、段尾总结）下界恒为 0：只惩罚「过量」不惩罚「缺少」
    const expectedMin = policy.mode === "upper-risk" ? 0 : Math.max(0, target - tolerance);
    const expectedMax = target + tolerance;
    if (actual >= expectedMin && actual <= expectedMax) continue;
    // 归一化越界距离：以容差与目标值的 25% 中较大者为基准，决定严重度等级
    const distance = actual < expectedMin ? expectedMin - actual : actual - expectedMax;
    const normalizedDistance = distance / Math.max(tolerance, Math.abs(target) * 0.25, 0.05);
    violations.push({
      metric: policy.key,
      label: policy.label,
      expectedMin: round(expectedMin),
      expectedMax: round(expectedMax),
      actual: round(actual),
      severity: normalizedDistance > 1.5 ? "high" : normalizedDistance > 0.65 ? "medium" : "low",
      rewriteHint: policy.rewriteHint
    });
  }

  // 扣分制：high 18 / medium 10 / low 4，上限 100 分；70 分且无 high 违规才算通过
  const penalty = violations.reduce((sum, violation) => sum + (violation.severity === "high" ? 18 : violation.severity === "medium" ? 10 : 4), 0);
  const score = Math.max(0, 100 - penalty);
  return {
    passed: score >= 70 && !violations.some((violation) => violation.severity === "high"),
    skipped: false,
    score,
    sourceContentLength: profile.sourceContentLength,
    generatedContentLength: generatedLength,
    violations,
    warnings: []
  };
}

/** 用编译出的稳定度量目标（区间 + 稳定度）评估正文，供 V2 编译缓存路径使用。 */
export function evaluateCompiledStyleCompliance(
  content: string,
  targets: Record<string, CompiledMetricTarget>,
  sourceContentLength: number
): WritingStyleComplianceReport {
  const generatedLength = content.replace(/\s+/g, "").length;
  // 无目标指标（所有度量未达稳定阈值）或文本过短时跳过
  if (sourceContentLength < 300 || generatedLength < 120 || !Object.keys(targets).length) {
    return {
      passed: true,
      skipped: true,
      score: null,
      sourceContentLength,
      generatedContentLength: generatedLength,
      violations: [],
      warnings: [!Object.keys(targets).length ? "没有达到稳定度阈值的量化指标。" : generatedLength < 120 ? "生成正文少于 120 字，未执行量化约束。" : "有效风格样本不足，未执行量化约束。"]
    };
  }
  const { localStats } = extractWritingStyleFeatures(content, "generated.md");
  const actualMetrics = localStats as unknown as Record<string, number>;
  const violations: StyleMetricViolation[] = [];
  for (const [metric, target] of Object.entries(targets)) {
    const actual = actualMetrics[metric];
    if (!Number.isFinite(actual)) continue;
    if (actual >= target.min && actual <= target.max) continue;
    const policy = policies.find((item) => item.key === metric);
    const distance = actual < target.min ? target.min - actual : actual - target.max;
    // 归一化基准取区间宽度与目标值 20% 中较大者，防止区间过窄导致高频误报
    const range = Math.max(target.max - target.min, Math.abs(target.target) * 0.2, 0.05);
    const normalized = distance / range;
    // 稳定度高的度量（>=0.75）轻微越界也判 high，因为它是可信核心风格指标
    const severity = target.stability >= 0.75 && normalized > 1.25 ? "high" : normalized > 0.5 ? "medium" : "low";
    violations.push({
      metric,
      label: policy?.label ?? metric,
      expectedMin: round(target.min),
      expectedMax: round(target.max),
      actual: round(actual),
      severity,
      rewriteHint: policy?.rewriteHint ?? "调整该指标，使其回到目标风格区间。"
    });
  }
  const penalty = violations.reduce((sum, item) => sum + (item.severity === "high" ? 18 : item.severity === "medium" ? 10 : 4), 0);
  const score = Math.max(0, 100 - penalty);
  return { passed: score >= 70 && !violations.some((item) => item.severity === "high"), skipped: false, score, sourceContentLength, generatedContentLength: generatedLength, violations, warnings: [] };
}

/** 把违规清单转成给模型的重写指令文本；low 级违规不进入指令，避免过度修改。 */
export function buildStyleRevisionInstruction(report: WritingStyleComplianceReport) {
  return report.violations
    .filter((violation) => violation.severity !== "low")
    .map(
      (violation, index) =>
        `${index + 1}. ${violation.label}：目标 ${violation.expectedMin}-${violation.expectedMax}，当前 ${violation.actual}。${violation.rewriteHint}`
    )
    .join("\n");
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

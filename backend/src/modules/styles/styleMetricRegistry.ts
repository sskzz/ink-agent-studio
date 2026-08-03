/**
 * 风格度量注册表。
 * 职责：集中登记所有可量化风格指标的定义（类型、取值域、是否可随场景调整），供聚合、编译、评估共用；
 * 边界：纯数据注册表，不含业务逻辑；未知度量返回 null，调用方自行降级处理。
 */

/** 度量定义：kind 决定取值域与容差策略，sceneAdjustable 控制场景调整是否可平移中心点。 */
export interface StyleMetricDefinition {
  key: string;
  kind: "ratio" | "density" | "length" | "count";
  domain: { min: number; max: number | null };
  sceneAdjustable: boolean;
}

// 比例类度量：取值恒在 [0,1]，场景调整影响最大；未列出 count 类（现有模型未使用）
const ratioMetrics = [
  "shortSentenceRatio",
  "longSentenceRatio",
  "sentenceLengthTransitionRatio",
  "independentShortParagraphRatio",
  "dialogueCharacterRatio",
  "pureDialogueParagraphRatio",
  "lexicalDiversity",
  "repeatedBigramRatio",
  "repeatedTrigramRatio",
  "repeatedParagraphOpeningRatio",
  "paragraphSummaryCandidateRatio"
];
const lengthMetrics = ["averageSentenceLength", "sentenceLengthStdDev", "averageLineLength", "paragraphLengthStdDev"];
const densityMetrics = [
  "actionWordDensity",
  "psychologyWordDensity",
  "sensoryWordDensity",
  "environmentWordDensity",
  "concreteObjectWordDensity",
  "abstractEmotionWordDensity",
  "connectorDensity",
  "causalExplanationDensity",
  "templatePatternDensity"
];

const registry = new Map<string, StyleMetricDefinition>([
  ...ratioMetrics.map((key) => [key, { key, kind: "ratio" as const, domain: { min: 0, max: 1 }, sceneAdjustable: true }] as const),
  // 长度/密度类上限 1000：只是统计安全上限，实际约束由编译阶段按样本区间给出
  ...lengthMetrics.map((key) => [key, { key, kind: "length" as const, domain: { min: 0, max: 1000 }, sceneAdjustable: true }] as const),
  ...densityMetrics.map((key) => [key, { key, kind: "density" as const, domain: { min: 0, max: 1000 }, sceneAdjustable: true }] as const)
]);

/** 查询度量定义；未注册的度量返回 null，调用方应跳过该度量。 */
export function getStyleMetricDefinition(key: string) {
  return registry.get(key) ?? null;
}

/** 把度量值夹取到定义域内，防止场景调整把目标值推出合法范围。 */
export function clampStyleMetric(key: string, value: number) {
  const definition = getStyleMetricDefinition(key);
  if (!definition) return value;
  return Math.min(definition.domain.max ?? Infinity, Math.max(definition.domain.min, value));
}

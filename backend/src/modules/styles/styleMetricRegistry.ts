export interface StyleMetricDefinition {
  key: string;
  kind: "ratio" | "density" | "length" | "count";
  domain: { min: number; max: number | null };
  sceneAdjustable: boolean;
}

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
  ...lengthMetrics.map((key) => [key, { key, kind: "length" as const, domain: { min: 0, max: 1000 }, sceneAdjustable: true }] as const),
  ...densityMetrics.map((key) => [key, { key, kind: "density" as const, domain: { min: 0, max: 1000 }, sceneAdjustable: true }] as const)
]);

export function getStyleMetricDefinition(key: string) {
  return registry.get(key) ?? null;
}

export function clampStyleMetric(key: string, value: number) {
  const definition = getStyleMetricDefinition(key);
  if (!definition) return value;
  return Math.min(definition.domain.max ?? Infinity, Math.max(definition.domain.min, value));
}

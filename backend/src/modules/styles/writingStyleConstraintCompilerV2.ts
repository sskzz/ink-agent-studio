import type { WritingStyleVersion } from "../../schemas/styleVersionSchemas.js";
import type { SceneClassification } from "../scenes/sceneClassifier.js";
import { resolveGenerationConstraints, type GenerationConstraint } from "../constraints/constraintResolver.js";
import type { SceneStyleAdjustment } from "./sceneStyleAdjustment.js";
import { hashStyleValue } from "./styleHash.js";
import { clampStyleMetric, getStyleMetricDefinition } from "./styleMetricRegistry.js";
import { sanitizeStyleConstraint } from "./styleConstraintSanitizer.js";
import type { CompiledAntiAiPolicy } from "../review/antiAi/antiAiConstraintCompiler.js";

export function compileWritingStyleConstraintsV2(
  version: WritingStyleVersion,
  scene: SceneClassification,
  adjustment: SceneStyleAdjustment,
  context: { userInstruction: string; outline: string; factualConstraints?: Array<{ id: string; source: "world" | "character"; text: string; sourceRef?: { fileId: string; contentHash?: string | null } }> },
  antiAiPolicy: CompiledAntiAiPolicy
) {
  const semantic = version.semanticProfile;
  const isV4 = semantic.schemaVersion === "style-analysis.v4";
  const constraints: GenerationConstraint[] = [];
  if (context.userInstruction.trim()) constraints.push({ id: "user-instruction", key: "chapter-goal", source: "user", priority: 80, hard: true, text: context.userInstruction.trim() });
  if (context.outline.trim()) constraints.push({ id: "chapter-outline", key: "chapter-outline", source: "outline", priority: 75, hard: true, text: context.outline.trim() });
  for (const fact of context.factualConstraints ?? []) {
    constraints.push({ id: fact.id, key: fact.id, source: fact.source, priority: fact.source === "world" ? 90 : 85, hard: true, text: fact.text, sourceRef: fact.sourceRef });
  }
  const invariantRules = isV4
    ? semantic.invariantRules
    : Object.values(semantic.executableRules).flat().filter((rule) => rule.priority <= 2).map((rule, index) => ({ id: `v3-invariant-${index}`, ...rule }));
  for (const rule of invariantRules) constraints.push({ id: rule.id, key: `style-rule:${rule.id}`, source: "style-invariant", priority: 70, hard: true, text: rule.rule });
  if (isV4) {
    for (const rule of semantic.flexibleRules) {
      constraints.push({ id: rule.id, key: `style-rule:${rule.id}`, source: "style-metric", priority: 40, hard: false, text: rule.rule });
    }
    const matchingSceneRules = semantic.sceneRules.filter((item) => item.sceneType === scene.primary || item.sceneType === "mixed");
    matchingSceneRules.flatMap((item) => item.rules).forEach((text, index) => {
      constraints.push({ id: `semantic-scene:${scene.primary}:${index}`, key: `semantic-scene:${index}`, source: "scene", priority: 60, hard: false, text });
    });
  }
  for (const [metric, aggregate] of Object.entries(version.aggregateProfile.metrics)) {
    if (aggregate.stability < version.constraintPolicy.softMetricStability) continue;
    const metricDefinition = getStyleMetricDefinition(metric);
    if (!metricDefinition) continue;
    const scenePolicy = adjustment.metricAdjustments[metric];
    const delta = metricDefinition.sceneAdjustable
      ? clamp(scenePolicy?.centerDelta ?? 0, -(scenePolicy?.maximumDelta ?? Infinity), scenePolicy?.maximumDelta ?? Infinity)
      : 0;
    const center = clampStyleMetric(metric, aggregate.median + delta);
    const halfRange = Math.max((aggregate.preferredMax - aggregate.preferredMin) / 2, 0.01) * (scenePolicy?.rangeScale ?? 1);
    const minimum = clampStyleMetric(metric, center - halfRange);
    const maximum = clampStyleMetric(metric, center + halfRange);
    constraints.push({
      id: `metric:${metric}`,
      key: `metric:${metric}`,
      source: "style-metric",
      priority: aggregate.stability >= version.constraintPolicy.strongMetricStability ? 50 : 40,
      hard: false,
      text: `${metric} 目标范围 ${round(minimum)}-${round(maximum)}`,
      metric: { min: round(Math.min(minimum, maximum)), max: round(Math.max(minimum, maximum)), target: round(center), stability: aggregate.stability }
    });
  }
  adjustment.semanticAdjustments.forEach((text, index) => constraints.push({ id: `scene:${scene.primary}:${index}`, key: `scene:${index}`, source: "scene", priority: 60, hard: false, text }));
  constraints.push(...antiAiPolicy.constraints);
  const resolution = resolveGenerationConstraints(constraints);
  const styleSnippet = isV4 ? semantic.stylePromptSnippet : semantic.stylePromptSnippet;
  const reviewSnippet = isV4 ? semantic.reviewPromptSnippet : semantic.reviewPromptSnippet;
  const styleSources = new Set(["style-invariant", "scene", "style-metric", "anti-ai-global", "anti-ai-style"]);
  const antiAiSources = new Set(["anti-ai-global", "anti-ai-style"]);
  const generationPrompt = compact([
    styleSnippet,
    antiAiPolicy.generationPrompt,
    ...resolution.applied
      .filter((item) => styleSources.has(item.source) && !antiAiSources.has(item.source) && !(item.source === "style-metric" && item.metric))
      .map((item) => item.text)
  ], 780);
  const reviewPrompt = compact([reviewSnippet, antiAiPolicy.reviewPrompt, ...resolution.applied.filter((item) => item.source === "style-invariant").map((item) => item.text)], 900);
  const targetMetrics = Object.fromEntries(resolution.applied.filter((item) => item.metric).map((item) => [item.key.replace("metric:", ""), item.metric!]));
  const hashCore = {
    styleId: version.styleId,
    styleVersionId: version.id,
    styleHash: version.styleHash,
    compilerVersion: "style-compiler.v2",
    antiAiRuleSetVersion: antiAiPolicy.ruleSetVersion,
    antiAiConstraintHash: antiAiPolicy.constraintHash,
    sceneType: scene.primary,
    generationPrompt,
    reviewPrompt,
    targetMetrics,
    styleConstraints: resolution.applied
      .filter((item) => styleSources.has(item.source))
      .map((item) => ({ id: item.id, source: item.source, text: item.text, metric: item.metric ?? null }))
  };
  return {
    ...hashCore,
    scene,
    antiAiPolicy,
    resolution,
    constraintHash: hashStyleValue(hashCore),
    degraded: resolution.degraded || version.aggregateProfile.status === "degraded",
    warnings: [...version.aggregateProfile.warnings, ...antiAiPolicy.warnings, ...resolution.warnings]
  };
}

function compact(parts: string[], limit: number) { let output = ""; for (const raw of parts) { const part = sanitizeStyleConstraint(raw); if (!part || output.includes(part)) continue; const next = output ? `${output}；${part}` : part; if (next.length > limit) continue; output = next; } return output; }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function round(value: number) { return Math.round(value * 100) / 100; }

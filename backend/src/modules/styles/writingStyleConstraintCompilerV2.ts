/**
 * 风格约束编译器（V2）。
 * 职责：基于版本化风格语义（WritingStyleVersion）、场景分类与场景调整，把所有约束（用户指令、大纲、事实约束、风格规则、场景规则、度量范围、反 AI 策略）合并并解析成最终写作/审稿 Prompt，同时产出内容寻址的 constraintHash；
 * 边界：纯函数，不访问磁盘；输入约束冲突时允许降级（degraded）而不是抛错；V1 的扁平编译逻辑仍保留在 writingStyleConstraintCompiler.ts 供旧路径使用。
 */
import type { WritingStyleVersion } from "../../schemas/styleVersionSchemas.js";
import type { SceneClassification } from "../scenes/sceneClassifier.js";
import { resolveGenerationConstraints, type GenerationConstraint } from "../constraints/constraintResolver.js";
import type { SceneStyleAdjustment } from "./sceneStyleAdjustment.js";
import { hashStyleValue } from "./styleHash.js";
import { clampStyleMetric, getStyleMetricDefinition } from "./styleMetricRegistry.js";
import { sanitizeStyleConstraint } from "./styleConstraintSanitizer.js";
import type { CompiledAntiAiPolicy } from "../review/antiAi/antiAiConstraintCompiler.js";

/**
 * 编译一版风格到写作/审稿约束。
 * @param version 风格版本语义与聚合度量
 * @param scene 当前章节场景分类
 * @param adjustment 场景风格调整（度量中心点/幅度变化）
 * @param context 上下文：用户指令、章节大纲、事实约束
 * @param antiAiPolicy 已编译的反 AI 审查策略
 * @returns 约束哈希 + 生成/审稿 Prompt + 解析结果与降级警告
 */
export function compileWritingStyleConstraintsV2(
  version: WritingStyleVersion,
  scene: SceneClassification,
  adjustment: SceneStyleAdjustment,
  context: { userInstruction: string; outline: string; factualConstraints?: Array<{ id: string; source: "world" | "character"; text: string; sourceRef?: { fileId: string; contentHash?: string | null } }> },
  antiAiPolicy: CompiledAntiAiPolicy
) {
  const semantic = version.semanticProfile;
  // V3 与 V4 语义模型差异：V3 只有 executableRules，需按优先级挑出硬性规则并映射为 invariant 规则
  const isV4 = semantic.schemaVersion === "style-analysis.v4";
  const constraints: GenerationConstraint[] = [];
  // 用户指令/大纲/事实约束：优先级最高且均为硬约束，事实约束里世界观（90）比角色（85）更优先
  if (context.userInstruction.trim()) constraints.push({ id: "user-instruction", key: "chapter-goal", source: "user", priority: 80, hard: true, text: context.userInstruction.trim() });
  if (context.outline.trim()) constraints.push({ id: "chapter-outline", key: "chapter-outline", source: "outline", priority: 75, hard: true, text: context.outline.trim() });
  for (const fact of context.factualConstraints ?? []) {
    constraints.push({ id: fact.id, key: fact.id, source: fact.source, priority: fact.source === "world" ? 90 : 85, hard: true, text: fact.text, sourceRef: fact.sourceRef });
  }
  // 不变量规则：任何场景、任何写法都必须遵守（如人物称谓、世界观设定），硬约束优先级 70
  const invariantRules = isV4
    ? semantic.invariantRules
    : Object.values(semantic.executableRules).flat().filter((rule) => rule.priority <= 2).map((rule, index) => ({ id: `v3-invariant-${index}`, ...rule }));
  for (const rule of invariantRules) constraints.push({ id: rule.id, key: `style-rule:${rule.id}`, source: "style-invariant", priority: 70, hard: true, text: rule.rule });
  if (isV4) {
    // 灵活规则为软约束（可被场景调整覆盖），优先级低于不变量
    for (const rule of semantic.flexibleRules) {
      constraints.push({ id: rule.id, key: `style-rule:${rule.id}`, source: "style-metric", priority: 40, hard: false, text: rule.rule });
    }
    // 只取匹配当前场景或混合场景的规则；mixed 意味着规则对所有场景生效
    const matchingSceneRules = semantic.sceneRules.filter((item) => item.sceneType === scene.primary || item.sceneType === "mixed");
    matchingSceneRules.flatMap((item) => item.rules).forEach((text, index) => {
      constraints.push({ id: `semantic-scene:${scene.primary}:${index}`, key: `semantic-scene:${index}`, source: "scene", priority: 60, hard: false, text });
    });
  }
  // 度量约束：稳定性不足（低于 softMetricStability）的度量不注入，避免噪声干扰生成；
  // 中心点按场景调整量平移，区间按 preferredMin/Max 与场景缩放系数计算，最终整体夹到合法度量范围
  for (const [metric, aggregate] of Object.entries(version.aggregateProfile.metrics)) {
    if (aggregate.stability < version.constraintPolicy.softMetricStability) continue;
    const metricDefinition = getStyleMetricDefinition(metric);
    if (!metricDefinition) continue;
    const scenePolicy = adjustment.metricAdjustments[metric];
    // 只有声明可场景调整的度量才允许平移中心点，防止场景配置越权改变核心风格
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
      // min/max 归一化处理，防止调整后区间翻转（min > max）
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
  // 生成 Prompt：排除带度量对象的约束（度量已单独进入 targetMetrics，避免重复文本），且不混入反 AI 文本
  const generationPrompt = compact([
    styleSnippet,
    antiAiPolicy.generationPrompt,
    ...resolution.applied
      .filter((item) => styleSources.has(item.source) && !antiAiSources.has(item.source) && !(item.source === "style-metric" && item.metric))
      .map((item) => item.text)
  ], 780);
  const reviewPrompt = compact([reviewSnippet, antiAiPolicy.reviewPrompt, ...resolution.applied.filter((item) => item.source === "style-invariant").map((item) => item.text)], 900);
  const targetMetrics = Object.fromEntries(resolution.applied.filter((item) => item.metric).map((item) => [item.key.replace("metric:", ""), item.metric!]));
  // 哈希核心：凡是影响生成结果的输入（风格版本、场景、反 AI 策略、编译后 Prompt）都纳入哈希，
  // 任一变化都会产生新 constraintHash，保证编译缓存按内容失效
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

/** 拼接文本：去重 + 逐条累加，超过 limit 的条目直接跳过（不截断），保证输出长度有界 */
function compact(parts: string[], limit: number) { let output = ""; for (const raw of parts) { const part = sanitizeStyleConstraint(raw); if (!part || output.includes(part)) continue; const next = output ? `${output}；${part}` : part; if (next.length > limit) continue; output = next; } return output; }
/** 数值夹取 */
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
/** 保留两位小数 */
function round(value: number) { return Math.round(value * 100) / 100; }

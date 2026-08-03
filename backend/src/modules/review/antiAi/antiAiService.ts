/**
 * 反 AI 服务（面向接口层）。
 * 职责：提供反 AI 规则集的概览（规则分类统计、版本、预算）与「生效约束预览」（指定风格/场景下编译后的 Prompt 与规则）；
 * 边界：只读服务，不触发模型调用；风格规则映射兼容 V4 语义画像与旧版 analysis.antiAiRules 两种来源。
 */
import { z } from "zod";
import { sceneTypeSchema } from "../../../schemas/styleVersionSchemas.js";
import type { WorkspacePaths } from "../../workspace/workspacePaths.js";
import { getWritingStyle } from "../../styles/writingStyleService.js";
import { resolveWritingStyleVersion } from "../../styles/writingStyleVersionService.js";
import { compileAntiAiPolicy, type StyleAntiAiRuleInput } from "./antiAiConstraintCompiler.js";
import { getAntiAiRuleSet } from "./antiAiRuleRegistry.js";

/** 预览输入：可选风格 id 与场景类型（默认 mixed）。 */
const previewInputSchema = z.object({
  styleId: z.string().trim().optional(),
  sceneType: sceneTypeSchema.optional().default("mixed")
});

/** 规则集概览：类别计数、版本信息、阶段覆盖与 Prompt 预算（供前端展示当前反 AI 能力）。 */
export function getAntiAiConstraintOverview() {
  const ruleSet = getAntiAiRuleSet();
  const compiled = compileAntiAiPolicy({ sceneType: "mixed" });
  const categories = Object.entries(
    ruleSet.rules.reduce<Record<string, number>>((counts, rule) => {
      counts[rule.category] = (counts[rule.category] ?? 0) + 1;
      return counts;
    }, {})
  ).map(([category, count]) => ({ category, count }));

  return {
    schemaVersion: ruleSet.schemaVersion,
    version: ruleSet.version,
    enabled: ruleSet.enabled,
    constraintHash: compiled.constraintHash,
    ruleCount: ruleSet.rules.length,
    guardCount: ruleSet.rules.filter((rule) => rule.level === "guard").length,
    stages: ["generation", "review", "polish"] as const,
    promptBudget: { generationCharacters: 480, reviewCharacters: 900 },
    categories,
    rules: ruleSet.rules
  };
}

/**
 * 预览指定风格 + 场景下实际生效的反 AI 约束（编译产物）。
 * @returns 编译后的策略：生成/审稿 Prompt、生效规则列表、去重数、警告
 */
export async function previewEffectiveAntiAiConstraints(paths: WorkspacePaths, input: unknown) {
  const parsed = previewInputSchema.parse(input);
  let styleName: string | null = null;
  let styleVersionId: string | null = null;
  let styleRules: StyleAntiAiRuleInput[] = [];

  if (parsed.styleId) {
    const style = await getWritingStyle(paths, parsed.styleId);
    styleName = style.name;
    const resolved = await resolveWritingStyleVersion(paths, style.id, null, style.latestVersionId ?? null);
    styleVersionId = resolved.version?.id ?? null;
    // 规则来源优先级：版本语义画像 > 旧版 analysis.antiAiRules；两者字段结构有差异，统一映射为 StyleAntiAiRuleInput
    styleRules = resolved.version
      ? resolved.version.semanticProfile.antiAiRules.map((rule, index) => mapStyleRule(rule, index))
      : (style.analysis?.antiAiRules ?? []).map((rule, index) => mapStyleRule(rule, index));
  }

  const compiled = compileAntiAiPolicy({ sceneType: parsed.sceneType, styleRules });
  return {
    styleId: parsed.styleId ?? null,
    styleName,
    styleVersionId,
    sceneType: parsed.sceneType,
    ruleSetVersion: compiled.ruleSetVersion,
    constraintHash: compiled.constraintHash,
    deduplicatedCount: compiled.deduplicatedCount,
    generationPrompt: compiled.generationPrompt,
    reviewPrompt: compiled.reviewPrompt,
    rules: compiled.effectiveRules,
    warnings: compiled.warnings
  };
}

/** 统一映射新旧两种反 AI 规则结构：无 id 的旧规则补 legacy- 前缀 id。 */
function mapStyleRule(rule: {
  id?: string;
  canonicalKey?: string;
  mode?: "tighten" | "relax" | "supplement";
  category?: StyleAntiAiRuleInput["category"];
  rule: string;
  detectHint: string;
  rewriteHint: string;
  severity: StyleAntiAiRuleInput["severity"];
}, index: number): StyleAntiAiRuleInput {
  return {
    id: rule.id ?? `legacy-anti-ai-${index + 1}`,
    canonicalKey: rule.canonicalKey,
    mode: rule.mode,
    category: rule.category,
    rule: rule.rule,
    detectHint: rule.detectHint,
    rewriteHint: rule.rewriteHint,
    severity: rule.severity
  };
}


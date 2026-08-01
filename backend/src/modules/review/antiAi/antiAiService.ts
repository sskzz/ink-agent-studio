import { z } from "zod";
import { sceneTypeSchema } from "../../../schemas/styleVersionSchemas.js";
import type { WorkspacePaths } from "../../workspace/workspacePaths.js";
import { getWritingStyle } from "../../styles/writingStyleService.js";
import { resolveWritingStyleVersion } from "../../styles/writingStyleVersionService.js";
import { compileAntiAiPolicy, type StyleAntiAiRuleInput } from "./antiAiConstraintCompiler.js";
import { getAntiAiRuleSet } from "./antiAiRuleRegistry.js";

const previewInputSchema = z.object({
  styleId: z.string().trim().optional(),
  sceneType: sceneTypeSchema.optional().default("mixed")
});

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


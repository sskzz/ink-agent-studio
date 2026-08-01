import { createHash } from "node:crypto";
import type { SceneType } from "../../../schemas/styleVersionSchemas.js";
import type { GenerationConstraint } from "../../constraints/constraintResolver.js";
import { sanitizeStyleConstraint } from "../../styles/styleConstraintSanitizer.js";
import {
  ANTI_AI_RULESET_VERSION,
  getAntiAiRuleSet,
  type AntiAiCategory,
  type AntiAiRule,
  type AntiAiSeverity
} from "./antiAiRuleRegistry.js";

export interface StyleAntiAiRuleInput {
  id?: string;
  canonicalKey?: string;
  mode?: "tighten" | "relax" | "supplement";
  category?: AntiAiCategory;
  rule: string;
  detectHint?: string;
  rewriteHint?: string;
  severity: AntiAiSeverity;
}

export interface EffectiveAntiAiRule extends AntiAiRule {
  origin: "global" | "style" | "merged";
  styleRuleId: string | null;
  mode: "inherit" | "tighten" | "relax" | "supplement";
}

export interface CompiledAntiAiPolicy {
  ruleSetVersion: string;
  constraintHash: string;
  sceneType: SceneType;
  generationPrompt: string;
  reviewPrompt: string;
  constraints: GenerationConstraint[];
  effectiveRules: EffectiveAntiAiRule[];
  deduplicatedCount: number;
  warnings: string[];
}

/**
 * 全局规则始终作为基线。风格规则先映射到 canonicalKey，再覆盖同键规则的表达和阈值，
 * 因此写作 Prompt 中不会同时出现两条语义相同的去 AI 味要求。
 */
export function compileAntiAiPolicy(input: { sceneType: SceneType; styleRules?: StyleAntiAiRuleInput[] }): CompiledAntiAiPolicy {
  const globalRules = getAntiAiRuleSet().rules;
  const effective = new Map<string, EffectiveAntiAiRule>(
    globalRules.map((rule) => [rule.canonicalKey, { ...rule, origin: "global", styleRuleId: null, mode: "inherit" }])
  );
  const warnings: string[] = [];
  let deduplicatedCount = 0;

  for (const [index, rawStyleRule] of (input.styleRules ?? []).entries()) {
    const rule = normalizeStyleRule(rawStyleRule, index);
    const existing = effective.get(rule.canonicalKey);
    if (!existing) {
      effective.set(rule.canonicalKey, createSupplementRule(rule));
      continue;
    }

    deduplicatedCount += 1;
    if (existing.level === "guard" && rule.mode === "relax") {
      warnings.push(`风格规则 ${rule.id} 尝试放宽不可变规则 ${existing.id}，已忽略。`);
      continue;
    }
    effective.set(rule.canonicalKey, mergeRule(existing, rule));
  }

  const ordered = [...effective.values()].sort(compareEffectiveRules);
  const generation = compactRules(ordered, (rule) => rule.promptClause, 480);
  const selectedIds = new Set(generation.includedIds);
  const selectedRules = ordered.filter((rule) => selectedIds.has(rule.id));
  const review = compactRules(
    selectedRules,
    (rule) => `${rule.id}：${rule.detectHint}；修正：${rule.rewriteHint}`,
    900
  );
  const constraints: GenerationConstraint[] = selectedRules.map((rule) => ({
    id: rule.id,
    key: `anti-ai:${rule.canonicalKey}`,
    source: rule.origin === "global" ? "anti-ai-global" : "anti-ai-style",
    priority: rule.level === "guard" ? 65 : rule.origin === "global" ? 35 : 40,
    hard: rule.level === "guard",
    text: rule.promptClause
  }));
  const hashCore = {
    ruleSetVersion: ANTI_AI_RULESET_VERSION,
    sceneType: input.sceneType,
    rules: selectedRules.map((rule) => ({ id: rule.id, canonicalKey: rule.canonicalKey, promptClause: rule.promptClause, mode: rule.mode }))
  };

  return {
    ruleSetVersion: ANTI_AI_RULESET_VERSION,
    constraintHash: createHash("sha256").update(JSON.stringify(hashCore)).digest("hex"),
    sceneType: input.sceneType,
    generationPrompt: generation.text,
    reviewPrompt: review.text,
    constraints,
    effectiveRules: ordered,
    deduplicatedCount,
    warnings
  };
}

function normalizeStyleRule(raw: StyleAntiAiRuleInput, index: number) {
  const rule = sanitizeStyleConstraint(raw.rule);
  const detectHint = sanitizeStyleConstraint(raw.detectHint ?? "") || "按该风格规则检查机械化表达";
  const rewriteHint = sanitizeStyleConstraint(raw.rewriteHint ?? "") || "按样本文风改写，同时保持剧情事实不变";
  const category = raw.category ?? inferCategory(`${rule} ${detectHint}`);
  return {
    id: raw.id?.trim() || `style-anti-ai-${index + 1}`,
    canonicalKey: raw.canonicalKey?.trim() || inferCanonicalKey(category, `${rule} ${detectHint}`),
    mode: raw.mode ?? "tighten" as const,
    category,
    rule,
    detectHint,
    rewriteHint,
    severity: raw.severity
  };
}

function mergeRule(existing: EffectiveAntiAiRule, styleRule: ReturnType<typeof normalizeStyleRule>): EffectiveAntiAiRule {
  const mode = styleRule.mode === "supplement" ? "tighten" : styleRule.mode;
  const preserveGuard = existing.level === "guard";
  return {
    ...existing,
    category: styleRule.category,
    severity: mergeSeverity(existing.severity, styleRule.severity, mode),
    promptClause: preserveGuard ? combineRuleText(existing.promptClause, styleRule.rule) : styleRule.rule || existing.promptClause,
    detectHint: preserveGuard ? combineRuleText(existing.detectHint, styleRule.detectHint) : styleRule.detectHint || existing.detectHint,
    rewriteHint: preserveGuard ? combineRuleText(existing.rewriteHint, styleRule.rewriteHint) : styleRule.rewriteHint || existing.rewriteHint,
    origin: "merged",
    styleRuleId: styleRule.id,
    mode
  };
}

function combineRuleText(base: string, addition: string) {
  if (!addition || base.includes(addition)) return base;
  if (addition.includes(base)) return addition;
  return `${base}；${addition}`;
}

function createSupplementRule(styleRule: ReturnType<typeof normalizeStyleRule>): EffectiveAntiAiRule {
  return {
    id: styleRule.id,
    canonicalKey: styleRule.canonicalKey,
    title: "风格补充规则",
    category: styleRule.category,
    level: "baseline",
    severity: styleRule.severity,
    promptClause: styleRule.rule,
    detectHint: styleRule.detectHint,
    rewriteHint: styleRule.rewriteHint,
    styleAdjustable: true,
    appliesTo: ["generation", "review", "polish"],
    origin: "style",
    styleRuleId: styleRule.id,
    mode: "supplement"
  };
}

function inferCanonicalKey(category: AntiAiCategory, text: string) {
  if (/段尾|总结|收束/u.test(text)) return "structure.paragraph-summary";
  if (/心理|情绪|感受|因果/u.test(text)) return "emotion.over-explained";
  if (/潜台词|对白|意图|说尽/u.test(text)) return "dialogue.over-explicit";
  if (/首先|其次|连接词|转场/u.test(text)) return "language.template-transition";
  if (/句式|排比|对称|节奏|长短句/u.test(text)) return "rhythm.uniform";
  if (/形容词|氛围|具体|物件|感官/u.test(text)) return "description.generic";
  if (/复述|重复|解释|说明/u.test(text)) return "logic.redundant-explanation";
  const fingerprint = createHash("sha256").update(text.replace(/\s+/gu, "")).digest("hex").slice(0, 12);
  return `style.${category}.${fingerprint}`;
}

function inferCategory(text: string): AntiAiCategory {
  if (/对白|台词|说话/u.test(text)) return "dialogue";
  if (/情绪|心理|感受/u.test(text)) return "emotion";
  if (/描写|环境|物件|感官|形容词/u.test(text)) return "description";
  if (/段落|段尾|结构|总结/u.test(text)) return "structure";
  if (/节奏|句长|长短句/u.test(text)) return "rhythm";
  if (/因果|解释|逻辑|复述/u.test(text)) return "logic";
  return "language";
}

function mergeSeverity(base: AntiAiSeverity, style: AntiAiSeverity, mode: "tighten" | "relax") {
  const levels: AntiAiSeverity[] = ["low", "medium", "high"];
  const baseIndex = levels.indexOf(base);
  const styleIndex = levels.indexOf(style);
  return levels[mode === "relax" ? Math.min(baseIndex, styleIndex) : Math.max(baseIndex, styleIndex)]!;
}

function compareEffectiveRules(left: EffectiveAntiAiRule, right: EffectiveAntiAiRule) {
  const level = Number(right.level === "guard") - Number(left.level === "guard");
  if (level) return level;
  const severity = { high: 3, medium: 2, low: 1 };
  return severity[right.severity] - severity[left.severity] || left.id.localeCompare(right.id);
}

function compactRules(rules: EffectiveAntiAiRule[], render: (rule: EffectiveAntiAiRule) => string, limit: number) {
  let text = "";
  const includedIds: string[] = [];
  for (const rule of rules) {
    const clause = sanitizeStyleConstraint(render(rule));
    if (!clause || text.includes(clause)) continue;
    const next = text ? `${text}；${clause}` : clause;
    if (next.length > limit) continue;
    text = next;
    includedIds.push(rule.id);
  }
  return { text, includedIds };
}

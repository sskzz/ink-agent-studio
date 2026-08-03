/**
 * 反 AI 约束编译器。
 * 职责：把全局规则（基线）与风格规则（按 canonicalKey 覆盖/新增）合并成一份生效的反 AI 策略，
 * 产出生成/审稿 Prompt、结构化约束与内容寻址的 constraintHash；
 * 边界：纯函数不访问磁盘；guard 级全局规则不可被风格规则放宽；同义规则只保留一条（语义去重）。
 */
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

/** 风格反 AI 规则输入（来自 V4 语义画像或旧版 analysis.antiAiRules），mode 决定覆盖方式。 */
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

/** 生效规则：origin 标识来源（全局/风格/合并），mode 标识覆盖方式。 */
export interface EffectiveAntiAiRule extends AntiAiRule {
  origin: "global" | "style" | "merged";
  styleRuleId: string | null;
  mode: "inherit" | "tighten" | "relax" | "supplement";
}

/** 编译产物：Prompt 文本、结构化约束、生效规则、去重数与警告。 */
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
 * 编译反 AI 策略。
 * 全局规则始终作为基线。风格规则先映射到 canonicalKey，再覆盖同键规则的表达和阈值，
 * 因此写作 Prompt 中不会同时出现两条语义相同的去 AI 味要求。
 * @param input.sceneType 场景类型（用于策略差异与哈希）
 * @param input.styleRules 风格规则（可选）
 * @returns 编译后的策略；风格规则尝试放宽 guard 规则时被忽略并记录警告
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
    // 无同键全局规则：作为补充规则新增（不影响其他规则的语义）
    if (!existing) {
      effective.set(rule.canonicalKey, createSupplementRule(rule));
      continue;
    }

    deduplicatedCount += 1;
    // 安全边界：guard 规则是红线，风格规则不允许 relax 放宽
    if (existing.level === "guard" && rule.mode === "relax") {
      warnings.push(`风格规则 ${rule.id} 尝试放宽不可变规则 ${existing.id}，已忽略。`);
      continue;
    }
    effective.set(rule.canonicalKey, mergeRule(existing, rule));
  }

  // guard 规则优先排前（先进入受限预算的 Prompt），同级按严重度降序
  const ordered = [...effective.values()].sort(compareEffectiveRules);
  // 生成 Prompt 预算 480 字符：先放规则正文，命中预算的规则才进入审稿 Prompt 与结构化约束
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
    // 哈希覆盖规则集版本、场景与最终生效的规则内容：任一变化都会产生新 constraintHash
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

/** 规范化风格规则输入：消毒文本、推断缺失的 category/canonicalKey/mode，避免脏数据进入 Prompt。 */
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

/**
 * 合并规则：风格规则接管非 guard 规则的文本与阈值（relax 会同时降低严重度）；
 * guard 规则保留原文、只做文本追加（不得被风格规则改写）。
 */
function mergeRule(existing: EffectiveAntiAiRule, styleRule: ReturnType<typeof normalizeStyleRule>): EffectiveAntiAiRule {
  // supplement 语义是补充说明，覆盖效果按 tighten 处理
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

/** 合并两段文本：去重后以中文分号连接，顺序为 基线；追加。 */
function combineRuleText(base: string, addition: string) {
  if (!addition || base.includes(addition)) return base;
  if (addition.includes(base)) return addition;
  return `${base}；${addition}`;
}

/** 为无同键全局规则的风格规则创建补充规则（baseline 级，可在各阶段生效）。 */
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

/** 从规则文本推断 canonicalKey：命中已知语义短语用全局键，否则用类别 + 文本指纹生成唯一键（保持幂等）。 */
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

/** 按文本关键词推断规则类别；无命中时归入 language。 */
function inferCategory(text: string): AntiAiCategory {
  if (/对白|台词|说话/u.test(text)) return "dialogue";
  if (/情绪|心理|感受/u.test(text)) return "emotion";
  if (/描写|环境|物件|感官|形容词/u.test(text)) return "description";
  if (/段落|段尾|结构|总结/u.test(text)) return "structure";
  if (/节奏|句长|长短句/u.test(text)) return "rhythm";
  if (/因果|解释|逻辑|复述/u.test(text)) return "logic";
  return "language";
}

/** 严重度合并：relax 取两者较低、tighten 取两者较高。 */
function mergeSeverity(base: AntiAiSeverity, style: AntiAiSeverity, mode: "tighten" | "relax") {
  const levels: AntiAiSeverity[] = ["low", "medium", "high"];
  const baseIndex = levels.indexOf(base);
  const styleIndex = levels.indexOf(style);
  return levels[mode === "relax" ? Math.min(baseIndex, styleIndex) : Math.max(baseIndex, styleIndex)]!;
}

/** 排序：guard 优先 → 严重度高优先 → 按 id 稳定排序。 */
function compareEffectiveRules(left: EffectiveAntiAiRule, right: EffectiveAntiAiRule) {
  const level = Number(right.level === "guard") - Number(left.level === "guard");
  if (level) return level;
  const severity = { high: 3, medium: 2, low: 1 };
  return severity[right.severity] - severity[left.severity] || left.id.localeCompare(right.id);
}

/** 预算内压缩：去重 + 超长跳过（不截断），保证输出严格不超过 limit；返回被选中的规则 id。 */
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

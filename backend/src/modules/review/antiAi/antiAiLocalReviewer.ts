/**
 * 本地反 AI 审查器。
 * 职责：用规则表对正文做低成本的机械化表达检测（段尾总结、解释过满、节奏均匀、元说明等），产出违规清单与分数；
 * 边界：只发现高置信的规则模式，不做语义判断；检测器按 canonicalKey 挂载，未注册键的规则跳过。
 */
import type { CompiledAntiAiPolicy, EffectiveAntiAiRule } from "./antiAiConstraintCompiler.js";
import type { AntiAiCategory, AntiAiSeverity } from "./antiAiRuleRegistry.js";

/** 单条本地反 AI 违规：evidence 为正文证据片段，hard 表示 guard 级规则违规。 */
export interface AntiAiLocalViolation {
  ruleId: string;
  canonicalKey: string;
  category: AntiAiCategory;
  severity: AntiAiSeverity;
  evidence: string;
  reason: string;
  rewriteHint: string;
  hard: boolean;
}

/** 本地反 AI 审查报告。 */
export interface AntiAiLocalReview {
  passed: boolean;
  score: number;
  violations: AntiAiLocalViolation[];
  warnings: string[];
}

/** 低成本本地检查始终执行；它只发现高置信模式，细微语义问题交给同一次联合审稿处理。
 * @returns 报告：任一 hard/高严重度违规或分数低于 75 时 passed=false
 */
export function evaluateAntiAiCompliance(content: string, policy: CompiledAntiAiPolicy): AntiAiLocalReview {
  const violations = policy.effectiveRules.flatMap((rule) => detectRule(content, rule));
  const penalty = violations.reduce((sum, item) => sum + (item.severity === "high" ? 20 : item.severity === "medium" ? 10 : 4), 0);
  const score = Math.max(0, 100 - penalty);
  return {
    passed: score >= 75 && !violations.some((item) => item.hard || item.severity === "high"),
    score,
    violations,
    warnings: []
  };
}

/** 把本地违规转成重写指令文本；low 级违规过滤。 */
export function buildAntiAiRevisionInstruction(review: AntiAiLocalReview) {
  return review.violations
    .filter((item) => item.severity !== "low")
    .map((item, index) => `${index + 1}. ${item.reason}。${item.rewriteHint}`)
    .join("\n");
}

/** 按 canonicalKey 找检测器；规则启用但无检测器时返回空（不误报）。 */
function detectRule(content: string, rule: EffectiveAntiAiRule): AntiAiLocalViolation[] {
  const detector = detectors[rule.canonicalKey];
  if (!detector) return [];
  const evidence = detector(content);
  if (!evidence) return [];
  return [{
    ruleId: rule.id,
    canonicalKey: rule.canonicalKey,
    category: rule.category,
    severity: rule.severity,
    evidence,
    reason: rule.detectHint,
    rewriteHint: rule.rewriteHint,
    hard: rule.level === "guard"
  }];
}

const detectors: Record<string, (content: string) => string | null> = {
  "output.prose-only": (content) => matchEvidence(content, /(?:作为\s*AI|分析如下|写作建议|以下是(?:续写|正文)|```)/iu),
  "logic.reader-coaching": (content) => matchEvidence(content, /(?:这(?:就)?说明|这意味着|显而易见|不难看出|由此可见)/u, 2),
  "structure.paragraph-summary": detectParagraphSummary,
  "logic.redundant-explanation": (content) => matchEvidence(content, /(?:换句话说|也就是说|之所以.{0,24}是因为|这也正是为什么)/u, 2),
  "emotion.over-explained": (content) => matchEvidence(content, /(?:他|她|他们|她们)(?:感到|意识到|明白了).{0,28}(?:因为|意味着|说明)/u, 2),
  "dialogue.over-explicit": (content) => matchEvidence(content, /“[^”]{0,80}(?:我的意思是|也就是说|我之所以|我真正想说的是)[^”]{0,80}”/u, 2),
  "language.template-transition": (content) => matchEvidence(content, /(?:首先|其次|再次|最后|总而言之|值得注意的是|与此同时)[，,]/u, 3),
  "rhythm.uniform": detectUniformRhythm,
  "description.generic": (content) => matchEvidence(content, /(?:美丽|壮丽|神秘|压抑|宁静|诡异|温馨)的(?:景色|氛围|气息|感觉|环境)/u, 3)
};

/** 正则命中证据：取第一处命中前 100 字；命中数不足 minimum 视为未违规（降低偶发词误报）。 */
function matchEvidence(content: string, pattern: RegExp, minimum = 1) {
  const matches = [...content.matchAll(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`))];
  if (matches.length < minimum) return null;
  return matches[0]?.[0]?.slice(0, 100) ?? null;
}

/** 段尾总结检测：取每段最后一句，命中「这一刻/归根结底」等总结收束词即违规。 */
function detectParagraphSummary(content: string) {
  const endings = content.split(/\n\s*\n/u).map((item) => item.trim()).filter(Boolean).map((item) => item.split(/[。！？!?]/u).filter(Boolean).at(-1)?.trim() ?? "");
  const hit = endings.find((item) => /^(?:这一刻|直到此时|从这一刻起|一切都|这便是|这就是|总而言之|归根结底)/u.test(item));
  return hit?.slice(0, 100) ?? null;
}

/** 节奏均匀检测：取最近 20 句长度，标准差 <3.2 字即判定节奏过于整齐（不足 8 句不判定）。 */
function detectUniformRhythm(content: string) {
  const lengths = content.split(/[。！？!?]/u).map((item) => item.replace(/\s+/gu, "").length).filter((length) => length >= 4).slice(-20);
  if (lengths.length < 8) return null;
  const average = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
  const deviation = Math.sqrt(lengths.reduce((sum, value) => sum + (value - average) ** 2, 0) / lengths.length);
  return deviation < 3.2 ? `最近 ${lengths.length} 句长度波动仅 ${deviation.toFixed(1)} 字` : null;
}


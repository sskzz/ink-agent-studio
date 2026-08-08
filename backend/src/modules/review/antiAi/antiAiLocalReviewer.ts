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
  qualityMetrics: {
    dialogueCharacterRatio: number;
    dialogueWithActionRatio: number;
    reactionCueDensity: number;
    sensoryCueDensity: number;
    longestExpositionParagraph: number;
  };
}

/** 低成本本地检查始终执行；它只发现高置信模式，细微语义问题交给同一次联合审稿处理。
 * @returns 报告：任一 hard/高严重度违规或分数低于 75 时 passed=false
 */
export function evaluateAntiAiCompliance(content: string, policy: CompiledAntiAiPolicy): AntiAiLocalReview {
  const qualityMetrics = measureScenePresence(content);
  const violations = [
    ...policy.effectiveRules.flatMap((rule) => detectRule(content, rule)),
    ...detectScenePresence(content, policy.sceneType, qualityMetrics)
  ];
  const penalty = violations.reduce((sum, item) => sum + (item.severity === "high" ? 20 : item.severity === "medium" ? 10 : 4), 0);
  const score = Math.max(0, 100 - penalty);
  return {
    passed: score >= 75 && !violations.some((item) => item.hard || item.severity === "high"),
    score,
    violations,
    warnings: [],
    qualityMetrics
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

/** 本地场景表现力指标：只测结构信号，不把固定比例当作所有场景的硬规则。 */
function measureScenePresence(content: string): AntiAiLocalReview["qualityMetrics"] {
  const normalized = content.replace(/\s+/gu, "");
  const dialogueMatches = [...content.matchAll(/[“"][^”"]{1,300}[”"]/gu)];
  const dialogueCharacters = dialogueMatches.reduce((sum, match) => sum + (match[0]?.replace(/[“”"]/gu, "").length ?? 0), 0);
  const reactionPattern = /(?:皱眉|挑眉|抿唇|咬唇|垂眼|眯眼|移开视线|眼神|嘴角|肩膀|肩头|呼吸|喉结|手指|攥紧|松开|怔住|僵住|停顿|顿了顿|愣住|笑了|轻笑|苦笑)/gu;
  const sensoryPattern = /(?:看见|瞥见|映着|光线|颜色|听见|声响|脚步声|嗓音|气味|闻到|触到|冰凉|温热|粗糙|柔软|刺痛|发麻|风|雨|灰尘|灯光)/gu;
  const reactionCount = [...content.matchAll(reactionPattern)].length;
  const sensoryCount = [...content.matchAll(sensoryPattern)].length;
  const dialogueWithAction = dialogueMatches.filter((match) => {
    const start = Math.max(0, (match.index ?? 0) - 50);
    const end = Math.min(content.length, (match.index ?? 0) + match[0].length + 50);
    return new RegExp(reactionPattern.source, "u").test(content.slice(start, end));
  }).length;
  const expositionParagraphs = content
    .split(/\n\s*\n|\n/gu)
    .map((paragraph) => paragraph.replace(/\s+/gu, ""))
    .filter((paragraph) => paragraph && !/[“"][^”"]+[”"]/u.test(paragraph));
  const perThousand = (count: number) => normalized.length ? count * 1000 / normalized.length : 0;
  return {
    dialogueCharacterRatio: round(dialogueCharacters / Math.max(1, normalized.length)),
    dialogueWithActionRatio: round(dialogueWithAction / Math.max(1, dialogueMatches.length)),
    reactionCueDensity: round(perThousand(reactionCount)),
    sensoryCueDensity: round(perThousand(sensoryCount)),
    longestExpositionParagraph: Math.max(0, ...expositionParagraphs.map((paragraph) => paragraph.length))
  };
}

/** 根据场景类型检查低互动、反应稀少、感官缺失与长篇说明；阈值只在相关场景启用。 */
function detectScenePresence(
  content: string,
  sceneType: CompiledAntiAiPolicy["sceneType"],
  metrics: AntiAiLocalReview["qualityMetrics"]
): AntiAiLocalViolation[] {
  const length = content.replace(/\s+/gu, "").length;
  if (length < 600) return [];
  const interactive = ["dialogue", "daily", "mixed"].includes(sceneType);
  const sensoryExpected = ["description", "suspense", "daily", "mixed"].includes(sceneType);
  const violations: AntiAiLocalViolation[] = [];
  const push = (item: Omit<AntiAiLocalViolation, "hard">) => violations.push({ ...item, hard: false });

  if (interactive && metrics.dialogueCharacterRatio < 0.04) {
    push({
      ruleId: "scene-presence-low-interaction",
      canonicalKey: "structure.low-interaction",
      category: "structure",
      severity: "medium",
      evidence: `互动场景对白字符占比仅 ${(metrics.dialogueCharacterRatio * 100).toFixed(1)}%`,
      reason: "互动场景主要在讲述事件，缺少人物之间的现场交换",
      rewriteHint: "把关键说明改成有目标和信息差的对白，并在对白间插入动作、停顿与反应"
    });
  }
  if (interactive && metrics.reactionCueDensity < 1.2) {
    push({
      ruleId: "scene-presence-missing-reaction",
      canonicalKey: "emotion.missing-reaction",
      category: "emotion",
      severity: "medium",
      evidence: `人物反应线索密度仅 ${metrics.reactionCueDensity}/千字`,
      reason: "人物受到刺激后缺少身体、表情或动作反应",
      rewriteHint: "在关键刺激后补入能改变对白或下一动作的即时反应，不要追加抽象情绪解释"
    });
  }
  if (sensoryExpected && length >= 900 && metrics.sensoryCueDensity < 0.8) {
    push({
      ruleId: "scene-presence-missing-sensory-anchor",
      canonicalKey: "description.missing-sensory-anchor",
      category: "description",
      severity: "medium",
      evidence: `感官线索密度仅 ${metrics.sensoryCueDensity}/千字`,
      reason: "场景缺少能影响人物行动的感官或物件锚点",
      rewriteHint: "选择一两个与冲突相关的声音、触感、光线或具体物件，让人物与其发生作用"
    });
  }
  if (metrics.longestExpositionParagraph >= 500) {
    push({
      ruleId: "scene-presence-exposition-run",
      canonicalKey: "structure.exposition-run",
      category: "structure",
      severity: "medium",
      evidence: `最长无对白说明段为 ${metrics.longestExpositionParagraph} 字`,
      reason: "存在过长的连续说明，场景推进被叙述摘要取代",
      rewriteHint: "把说明拆回人物当下的观察、选择、对白和环境反馈，并保留信息递进"
    });
  }
  return violations;
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

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

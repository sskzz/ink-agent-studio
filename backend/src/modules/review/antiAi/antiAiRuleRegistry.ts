export type AntiAiCategory = "emotion" | "dialogue" | "description" | "structure" | "language" | "logic" | "rhythm";
export type AntiAiSeverity = "low" | "medium" | "high";
export type AntiAiStage = "generation" | "review" | "polish";

export interface AntiAiRule {
  id: string;
  canonicalKey: string;
  title: string;
  category: AntiAiCategory;
  level: "guard" | "baseline";
  severity: AntiAiSeverity;
  promptClause: string;
  detectHint: string;
  rewriteHint: string;
  styleAdjustable: boolean;
  appliesTo: AntiAiStage[];
}

export const ANTI_AI_RULESET_VERSION = "anti-ai-rules.v1";

const rules: AntiAiRule[] = [
  {
    id: "anti-ai-output-only",
    canonicalKey: "output.prose-only",
    title: "只输出小说正文",
    category: "structure",
    level: "guard",
    severity: "high",
    promptClause: "只写小说正文，不输出分析、提纲、说明、建议、代码块或模型自述",
    detectHint: "出现“分析如下”“写作建议”“作为 AI”等元说明，或使用 Markdown 代码块包裹正文",
    rewriteHint: "删除全部元说明和格式外壳，只保留连续小说正文",
    styleAdjustable: false,
    appliesTo: ["generation", "review", "polish"]
  },
  {
    id: "anti-ai-no-reader-coaching",
    canonicalKey: "logic.reader-coaching",
    title: "不替读者解释结论",
    category: "logic",
    level: "guard",
    severity: "high",
    promptClause: "不替读者总结人物、情节意义或提示应当如何理解",
    detectHint: "叙述直接给出“这说明”“这意味着”“显而易见”等解释性结论",
    rewriteHint: "删除结论句，保留能够让读者自行判断的动作、对白或后果",
    styleAdjustable: false,
    appliesTo: ["generation", "review", "polish"]
  },
  {
    id: "anti-ai-paragraph-summary",
    canonicalKey: "structure.paragraph-summary",
    title: "避免段尾机械总结",
    category: "structure",
    level: "baseline",
    severity: "high",
    promptClause: "段落用动作、对白、物件或环境变化收束，不追加抽象总结",
    detectHint: "段尾重复概括刚发生的事件、人物情绪或关系变化",
    rewriteHint: "删去总结句，用可观察反应或未完成动作结束段落",
    styleAdjustable: true,
    appliesTo: ["generation", "review", "polish"]
  },
  {
    id: "anti-ai-redundant-explanation",
    canonicalKey: "logic.redundant-explanation",
    title: "避免重复解释",
    category: "logic",
    level: "baseline",
    severity: "high",
    promptClause: "同一信息只表达一次，不在叙述、心理和对白中轮流复述",
    detectHint: "相邻句段以不同措辞重复相同原因、判断或已知事实",
    rewriteHint: "保留信息量最高的一处，其余改为新的行动、反应或留白",
    styleAdjustable: true,
    appliesTo: ["generation", "review", "polish"]
  },
  {
    id: "anti-ai-overexplained-emotion",
    canonicalKey: "emotion.over-explained",
    title: "情绪不过度解释",
    category: "emotion",
    level: "baseline",
    severity: "medium",
    promptClause: "情绪优先通过动作、感官和选择呈现，不连续解释心理因果",
    detectHint: "动作或对白已经传达情绪后，叙述再次命名情绪并解释原因",
    rewriteHint: "删去情绪标签与因果说明，保留身体反应、动作偏差或环境反馈",
    styleAdjustable: true,
    appliesTo: ["generation", "review", "polish"]
  },
  {
    id: "anti-ai-overexplicit-dialogue",
    canonicalKey: "dialogue.over-explicit",
    title: "对白保留潜台词",
    category: "dialogue",
    level: "baseline",
    severity: "medium",
    promptClause: "对白不把动机和关系说尽，允许停顿、回避、误解与信息差",
    detectHint: "角色直接完整说明自己的真实意图、情绪、关系和前因后果",
    rewriteHint: "删减直白说明，用答非所问、动作插入或话题转移保留潜台词",
    styleAdjustable: true,
    appliesTo: ["generation", "review", "polish"]
  },
  {
    id: "anti-ai-template-transition",
    canonicalKey: "language.template-transition",
    title: "减少模板连接词",
    category: "language",
    level: "baseline",
    severity: "medium",
    promptClause: "少用首先、其次、与此同时、总之等报告式连接词推进叙事",
    detectHint: "连续使用书面连接词组织本应由动作或时间变化完成的转场",
    rewriteHint: "用时间、位置、人物动作或视线变化直接建立句段关系",
    styleAdjustable: true,
    appliesTo: ["generation", "review", "polish"]
  },
  {
    id: "anti-ai-uniform-rhythm",
    canonicalKey: "rhythm.uniform",
    title: "避免节奏过度整齐",
    category: "rhythm",
    level: "baseline",
    severity: "medium",
    promptClause: "按场景需要变化句长与段落密度，避免连续对称句和同构排比",
    detectHint: "大量相邻句长度接近、句法结构相同，或连续使用三段式排比",
    rewriteHint: "打散句式，穿插短动作、停顿或较长观察句形成节奏落差",
    styleAdjustable: true,
    appliesTo: ["generation", "review", "polish"]
  },
  {
    id: "anti-ai-generic-description",
    canonicalKey: "description.generic",
    title: "描写使用具体细节",
    category: "description",
    level: "baseline",
    severity: "medium",
    promptClause: "描写选择少量可感知细节，不用抽象氛围词和形容词堆叠代替观察",
    detectHint: "只用美丽、神秘、压抑、宁静等泛化形容词描述场景或气氛",
    rewriteHint: "换成能被看见、听见、触到或影响人物行动的具体对象",
    styleAdjustable: true,
    appliesTo: ["generation", "review", "polish"]
  }
];

export function getAntiAiRuleSet() {
  return {
    schemaVersion: "anti-ai-rule-set.v1" as const,
    version: ANTI_AI_RULESET_VERSION,
    enabled: true,
    rules: rules.map((rule) => ({ ...rule, appliesTo: [...rule.appliesTo] }))
  };
}


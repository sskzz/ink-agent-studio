/**
 * 内置技能定义。
 * 职责：集中声明随应用自带的工作流技能（章节规划、续写、伏笔检查、连续性审查、去 AI 味、风格复刻）；
 * 边界：内置技能是可审计的纯工作流说明，不包含模型调用、文件写入或工具授权；内容变更须同时升级索引哈希机制（自动升版本）。
 */
import type { NovelSkillOperation } from "@ink-agent/contracts";

/** 内置技能定义：appliesTo 限定适用操作，triggerTerms 供选择器模糊匹配，priority 决定候选顺序。 */
export interface BuiltinSkillDefinition {
  id: string;
  name: string;
  description: string;
  appliesTo: NovelSkillOperation[];
  triggerTerms: string[];
  priority: number;
  instructions: string;
}

/** 内置技能是可审计的纯工作流说明，不包含模型调用、文件写入或工具授权。 */
export const builtinSkillDefinitions: BuiltinSkillDefinition[] = [
  {
    id: "chapter-planning",
    name: "章节规划",
    description: "把章纲拆成可执行的场景目标、冲突推进、信息释放和收束点。",
    appliesTo: ["planning", "writing"],
    triggerTerms: ["规划", "章纲", "场景", "节奏", "推进", "章节"],
    priority: 80,
    instructions: `先明确本章唯一主线目标，再拆成 3 至 6 个连续场景。每个场景必须说明人物当下目标、阻力、可观察行动、信息变化和离场条件。优先让冲突通过行动和对白推进，避免把章纲写成抽象主题列表。结尾留下可验证的下一章钩子，但不得凭空覆盖作品事实。`
  },
  {
    id: "continuation-writing",
    name: "章节续写",
    description: "在不覆盖既有正文和权威事实的前提下，续写自然、可读、可复核的正文。",
    appliesTo: ["writing"],
    triggerTerms: ["续写", "继续", "正文", "扩写", "场景"],
    priority: 95,
    instructions: `续写必须从已有正文的最后一个可观察动作或状态接起，不重复已有内容。先保持视角、时间线、人物当前状态和专有名词一致，再推进本次指令要求的事件。新信息只能作为草稿建议出现；不确定的事实宁可留出待确认点，也不要伪造 BookState。输出只包含正文，不输出分析、技能说明或元话语。`
  },
  {
    id: "foreshadowing-check",
    name: "伏笔检查",
    description: "检查本章新增、回收、延迟和冲突的伏笔，并给出证据化建议。",
    appliesTo: ["planning", "review"],
    triggerTerms: ["伏笔", "回收", "悬念", "线索", "暗示"],
    priority: 75,
    instructions: `逐项区分已埋伏笔、正在回收、已回收和疑似断线。每个判断都要引用章节或状态中的具体证据，说明读者当前能否理解其因果。不要为了制造悬念强行增加新设定；需要修改权威状态时只能提出 Patch 建议，不能直接写入。`
  },
  {
    id: "continuity-review",
    name: "连续性审查",
    description: "从时间线、人物状态、空间位置、因果和设定约束检查正文连续性。",
    appliesTo: ["review"],
    triggerTerms: ["连续性", "一致性", "审查", "时间线", "人物状态", "设定"],
    priority: 90,
    instructions: `按时间线、空间位置、人物状态、物件归属、因果链和世界观规则逐项审查。只报告能由权威事实或正文证据支持的问题，区分确定冲突与待确认疑点。每条问题给出证据、影响和最小修复建议；修复正文与修复 BookState 必须分开。`
  },
  {
    id: "anti-ai-polish",
    name: "去 AI 味",
    description: "识别套话、总结腔、心理解释过满和句式机械等风险，优先提出最小改写。",
    appliesTo: ["writing", "review"],
    triggerTerms: ["去 ai 味", "去AI味", "自然", "润色", "机械", "套话"],
    priority: 85,
    instructions: `优先检查段尾总结、心理解释过满、过度对称排比、抽象形容词堆叠、对白说尽潜台词和动作缺少具体对象。改写时保留剧情事实、人物行动结果、信息顺序和叙事视角，用可观察动作、对白停顿、环境反馈替代空泛判断。不要为了“自然”引入未经授权的剧情。`
  },
  {
    id: "style-replication",
    name: "风格复刻",
    description: "根据已锁定的风格版本复用稳定规则，并把场景化规则降为软约束。",
    appliesTo: ["writing", "review"],
    triggerTerms: ["风格", "语气", "复刻", "句式", "叙事距离", "文风"],
    priority: 80,
    instructions: `先读取已锁定的风格版本和其约束来源。不可变规则用于保持叙事视角、距离、核心节奏和表达边界；可变规则只能影响措辞、描写密度和对白比例。不得复制样本原句，不得把样本中的事实带入当前作品，不得让风格规则覆盖人物状态或用户本次指令。`
  }
];

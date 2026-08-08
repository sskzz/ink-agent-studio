/**
 * 章节细纲规划器（两步式生成：第一轮细纲 → 第二轮正文）。
 *
 * 输入：章节标题 + 静态细纲（可为空）+ 用户指令 + 当前关注点（current_focus）
 *      + 伏笔池待推进条目 + 下一阶段目标（来自权威状态 runtime.json）；
 * 输出：结构化章节细纲 `chapter-outline.v1`：
 *      - scenes：分场景的正文布局（每场景的目标、事件、推进），供正文生成严格遵循；
 *      - progression：本章剧情推进（从哪到哪）；
 *      - foreshadowing：本章伏笔动作（植入 plant / 推进 advance / 回收 payoff，尽量引用伏笔池 id）。
 * 降级策略：模型调用失败或校验不通过时返回 null，正文回退到静态细纲 + 本章意图，照常生成。
 */
import { z } from "zod";
import { generateModelText } from "../ai/modelGateway.js";
import { getModelConfig, getModelRoutes } from "../models/modelConfigRepository.js";
import type { RuntimeState } from "../../schemas/runtimeStateSchemas.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { renderBookGenerationMetadata, type BookGenerationMetadata } from "./bookGenerationMetadata.js";

/** 单场景：正文中的一幕布局。 */
export interface ChapterOutlineScene {
  /** 场景功能，用于选择互动、行动或过渡的写法。 */
  sceneType?: "action" | "dialogue" | "introspection" | "description" | "suspense" | "climax" | "transition" | "daily" | "mixed";
  goal: string;
  /** 当前场景中人物面对的具体阻力。 */
  conflict?: string;
  /** 该场景推进的具体事件与冲突（按顺序）。 */
  events: string[];
  /** 必须写到正文中的关键动作节拍。 */
  actionBeat?: string;
  /** 对话要达成的目的；非互动场景可留空。 */
  dialogueGoal?: string;
  /** 对话未直接说出的信息。 */
  subtext?: string;
  /** 人物面对刺激时可观察的即时反应。 */
  characterReaction?: string;
  /** 与人物行动相关的感官细节。 */
  sensoryAnchor?: string;
  /** 场景内部的转折。 */
  turn?: string;
  /** 事件结束后，场景向人物/关系/局势的变化。 */
  progression: string;
}

/** 单条伏笔动作：默认关联伏笔池条目 id。 */
export interface ChapterOutlineForeshadow {
  /** 伏笔池条目 id（引用）；无法绑定时为 null。 */
  item: string | null;
  /** 植入/推进/回收。 */
  action: "plant" | "advance" | "payoff";
  note: string;
}

/** 章节细纲：第二轮正文生成的叙事蓝图。 */
export interface ChapterOutline {
  /** 本章的一句话核心定位。 */
  summary: string;
  /** 按顺序排列的场景；正文应逐场景展开。 */
  scenes: ChapterOutlineScene[];
  /** 本章剧情推进：从哪到哪。 */
  progression: { from: string; to: string };
  /** 本章伏笔动作；优先引用伏笔池条目。 */
  foreshadowing: ChapterOutlineForeshadow[];
}

export const chapterOutlineSchema = z.object({
  schemaVersion: z.literal("chapter-outline.v1"),
  summary: z.string().trim().min(1).max(160),
  scenes: z.array(z.object({
    sceneType: z.enum(["action", "dialogue", "introspection", "description", "suspense", "climax", "transition", "daily", "mixed"]).optional(),
    goal: z.string().trim().min(1).max(200),
    conflict: z.string().trim().min(1).max(200).optional(),
    events: z.array(z.string().trim().min(1).max(200)).min(1).max(4),
    actionBeat: z.string().trim().min(1).max(200).optional(),
    dialogueGoal: z.string().trim().min(1).max(200).optional(),
    subtext: z.string().trim().min(1).max(200).optional(),
    characterReaction: z.string().trim().min(1).max(200).optional(),
    sensoryAnchor: z.string().trim().min(1).max(200).optional(),
    turn: z.string().trim().min(1).max(200).optional(),
    progression: z.string().trim().min(1).max(200)
  })).min(1).max(6),
  progression: z.object({
    from: z.string().trim().min(1).max(160),
    to: z.string().trim().min(1).max(160)
  }),
  foreshadowing: z.array(z.object({
    item: z.string().nullable().optional(),
    action: z.enum(["plant", "advance", "payoff"]),
    note: z.string().trim().min(1).max(240)
  })).max(10).default([])
});

/** 伏笔池可被本章推进/回收的条目（planned/planted/resolving）。 */
function listAdvanceableForeshadowing(runtimeState: RuntimeState | null) {
  return (runtimeState?.state.foreshadowing ?? [])
    .filter((item) => item.status === "planned" || item.status === "planted" || item.status === "resolving")
    .map((item) => `${item.id}（${item.status}）：${item.content}`)
    .join("\n");
}

/**
 * 生成本章细纲。
 * @param chapterOutline 章节静态细纲（可为空）
 * @param instruction 用户续写指令（可为空）
 * @param currentFocus current_focus.md 内容（可为空）
 * @param runtimeState 权威状态（提供伏笔池与下一阶段目标）
 */
export async function planChapterOutline(
  workspacePaths: WorkspacePaths,
  options: {
    chapterTitle: string;
    chapterOutline: string;
    instruction: string;
    currentFocus: string;
    runtimeState: RuntimeState | null;
    bookMetadata?: BookGenerationMetadata;
  }
): Promise<ChapterOutline | null> {
  const routes = await getModelRoutes(workspacePaths);
  const planningModelId = routes.planningModelId ?? routes.writingModelId;
  if (!planningModelId) return null;
  const model = await getModelConfig(workspacePaths, planningModelId);
  if (!model.enabled) return null;

  const pendingForeshadowing = listAdvanceableForeshadowing(options.runtimeState);
  const nextGoals = (options.runtimeState?.state.nextGoals ?? []).join("\n") || "（无）";

  const systemPrompt = [
    "你是小说章节细纲规划师。在生成正文之前，先根据已有设定、当前关注点、伏笔池与下一阶段目标，规划本章的执行蓝图（细纲），供正文生成严格遵循。",
    "只输出 chapter-outline.v1 JSON 对象：",
    "- summary：本章核心定位的一句话",
    "- scenes：按顺序排列的 3-5 个场景；每场景必须给出 sceneType、goal、conflict、events、actionBeat、characterReaction、sensoryAnchor、turn、progression",
    "- dialogue/daily/mixed 等互动场景还必须给出 dialogueGoal 与 subtext；其他场景可以省略这两项",
    "- 场景必须能直接扩写成现场：人物有目标和阻力，发生可观察动作，对刺激产生即时反应，并以转折或结果结束；不要只列信息说明",
    "- progression：本章剧情推进的起点（from）与终点（to）",
    "- foreshadowing：本章伏笔动作 —— plant（植入新伏笔）/ advance（推进已有伏笔）/ payoff（回收伏笔）；item 尽量引用伏笔池中的 id",
    "伏笔调度必须延续伏笔池状态：advance/payoff 应让池中 planned/planted/resolving 条目逐步走向回收，不在正文层面实现，只做安排。",
    "不要输出正文，不要复制细纲与伏笔池原文，保持具体克制。"
  ].join("\n");

  const userPrompt = [
    options.bookMetadata ? `【作品生成元数据】\n${renderBookGenerationMetadata(options.bookMetadata)}` : "",
    `【章节】${options.chapterTitle}`,
    `【已有细纲】${options.chapterOutline || "（未提供，按当前状态规划）"}`,
    `【用户指令】${options.instruction || "（无）"}`,
    options.currentFocus ? `【当前关注点】\n${options.currentFocus.slice(0, 2_000)}` : "",
    `【伏笔池待推进/回收】\n${pendingForeshadowing || "（无）"}`,
    `【下一阶段目标】\n${nextGoals}`,
    "只输出 JSON。"
  ].filter(Boolean).join("\n\n");

  try {
    const result = await generateModelText(workspacePaths, model, {
      systemPrompt,
      userPrompt,
      temperature: 0.4,
      maxTokens: 2_200,
      responseFormat: "json_object",
      timeoutMs: 60_000
    });
    const start = result.text.indexOf("{");
    const end = result.text.lastIndexOf("}");
    if (start < 0 || end < start) return null;
    const parsed = chapterOutlineSchema.parse(JSON.parse(result.text.slice(start, end + 1)));
    return {
      summary: parsed.summary,
      scenes: parsed.scenes,
      progression: parsed.progression,
      foreshadowing: parsed.foreshadowing.map((item) => ({
        item: item.item ?? null,
        action: item.action,
        note: item.note
      }))
    };
  } catch {
    return null;
  }
}

/** 把细纲渲染为正文（scene 层）约束文本，供正文生成严格按此推进。 */
export function renderChapterOutline(plan: ChapterOutline): string {
  const scenes = plan.scenes
    .map((scene, index) => {
      const events = scene.events.map((event) => `- ${event}`).join("\n");
      const contract = [
        scene.sceneType ? `类型：${scene.sceneType}` : "",
        `目标：${scene.goal}`,
        scene.conflict ? `冲突：${scene.conflict}` : "",
        events,
        scene.actionBeat ? `动作节拍：${scene.actionBeat}` : "",
        scene.dialogueGoal ? `对话目标：${scene.dialogueGoal}` : "",
        scene.subtext ? `潜台词：${scene.subtext}` : "",
        scene.characterReaction ? `人物反应：${scene.characterReaction}` : "",
        scene.sensoryAnchor ? `感官锚点：${scene.sensoryAnchor}` : "",
        scene.turn ? `转折：${scene.turn}` : "",
        `推进：${scene.progression}`
      ].filter(Boolean).join("\n");
      return `场景 ${index + 1}\n${contract}`;
    })
    .join("\n\n");
  const foreshadowing = plan.foreshadowing.length > 0
    ? "伏笔安排：\n" + plan.foreshadowing
      .map((item) => `- [${item.action}]${item.item ? `（伏笔池 ${item.item}）` : "（新伏笔）"}：${item.note}`)
      .join("\n")
    : "（本章无伏笔安排）";
  return `【本章要点】${plan.summary}\n【推进】从「${plan.progression.from}」推进至「${plan.progression.to}」\n\n${scenes}\n\n${foreshadowing}`;
}

/**
 * 章节意图规划器（借鉴 InkOS Planner）：续写前生成本章意图（must-keep / must-avoid）。
 *
 * 输入：当前关注点（current_focus）+ 伏笔池待回收条目 + 下一阶段目标 + 章节细纲 + 用户指令；
 * 输出：结构化意图（Zod 校验），注入写作 prompt 的 scene 层，指导本章"必须延续什么、避免什么"。
 * 降级策略：模型调用失败或校验不过时返回 null，续写照常进行（只少一条意图约束）。
 */
import { z } from "zod";
import { generateModelText } from "../ai/modelGateway.js";
import { getModelConfig, getModelRoutes } from "../models/modelConfigRepository.js";
import type { RuntimeState } from "../../schemas/runtimeStateSchemas.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { renderBookGenerationMetadata, type BookGenerationMetadata } from "./bookGenerationMetadata.js";

/** 章节意图：mustKeep 为本章必须延续的内容，mustAvoid 为本章必须避免的内容。 */
export interface ChapterIntent {
  mustKeep: string[];
  mustAvoid: string[];
}

const chapterIntentSchema = z.object({
  schemaVersion: z.literal("chapter-intent.v1"),
  mustKeep: z.array(z.string().trim().min(1).max(200)).max(10),
  mustAvoid: z.array(z.string().trim().min(1).max(200)).max(10)
});

/**
 * 生成本章意图。
 * @param chapterOutline 章节细纲（可空）
 * @param instruction 用户续写指令（可空）
 * @param currentFocus current_focus.md 内容（可空）
 * @param runtimeState 权威状态（提供待回收伏笔与下一阶段目标）
 */
export async function planChapterIntent(
  workspacePaths: WorkspacePaths,
  chapterTitle: string,
  chapterOutline: string,
  instruction: string,
  currentFocus: string,
  runtimeState: RuntimeState | null,
  bookMetadata?: BookGenerationMetadata
): Promise<ChapterIntent | null> {
  const routes = await getModelRoutes(workspacePaths);
  const planningModelId = routes.planningModelId ?? routes.writingModelId;
  if (!planningModelId) return null;
  const model = await getModelConfig(workspacePaths, planningModelId);
  if (!model.enabled) return null;

  const pendingForeshadowing = (runtimeState?.state.foreshadowing ?? [])
    .filter((item) => item.status === "planned" || item.status === "planted")
    .map((item) => `${item.id}（${item.status}）：${item.content}`)
    .join("\n");
  const nextGoals = (runtimeState?.state.nextGoals ?? []).join("\n") || "（无）";

  const systemPrompt = [
    "你是小说章节规划师。根据当前关注点、待回收伏笔、下一阶段目标与章节细纲，生成本章意图。",
    "只输出 chapter-intent.v1 JSON 对象：",
    "- mustKeep：本章必须延续或推进的事实、状态、伏笔（2-6 条，引用现有设定）",
    "- mustAvoid：本章必须避免的冲突或遗漏（如设定矛盾、伏笔提前回收、遗忘已发生事件）",
    "不要输出正文，不要重复细纲原文，保持简洁具体。"
  ].join("\n");
  const userPrompt = [
    bookMetadata ? `【作品生成元数据】\n${renderBookGenerationMetadata(bookMetadata)}` : "",
    `【章节】${chapterTitle}`,
    `【细纲】${chapterOutline || "未提供"}`,
    `【用户指令】${instruction || "（无）"}`,
    currentFocus ? `【当前关注点】\n${currentFocus.slice(0, 1_500)}` : "",
    `【待回收伏笔】\n${pendingForeshadowing || "（无）"}`,
    `【下一阶段目标】\n${nextGoals}`,
    "只输出 JSON。"
  ].filter(Boolean).join("\n\n");

  try {
    const result = await generateModelText(workspacePaths, model, {
      systemPrompt,
      userPrompt,
      temperature: 0.2,
      maxTokens: 1_200,
      responseFormat: "json_object",
      timeoutMs: 60_000
    });
    const start = result.text.indexOf("{");
    const end = result.text.lastIndexOf("}");
    if (start < 0 || end < start) return null;
    const parsed = chapterIntentSchema.parse(JSON.parse(result.text.slice(start, end + 1)));
    return { mustKeep: parsed.mustKeep, mustAvoid: parsed.mustAvoid };
  } catch {
    return null;
  }
}

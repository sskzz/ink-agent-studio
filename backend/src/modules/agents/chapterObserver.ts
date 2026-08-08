/**
 * 章节观察者（Observer）：从章节正文提取结构化状态增量（JSON delta）。
 *
 * 借鉴 InkOS 的 Observer 角色：写手产出正文后，由观察者从正文中提取事实变化
 * （角色状态、物品转移、伏笔推进、章节摘要），输出严格校验的 JSON delta，
 * 由代码层 immutable 应用（applyStateDelta + 重放），而不是让模型直接改状态文件。
 *
 * 降级策略：模型调用失败或 delta 校验不通过时返回 { ok: false }，绝不阻断章节保存；
 * 状态保持上一版本，投影不刷新。
 */
import { z } from "zod";
import { stateDeltaSchema, type StateDelta } from "../../schemas/runtimeStateSchemas.js";
import { generateModelText } from "../ai/modelGateway.js";
import { getModelConfig, getModelRoutes } from "../models/modelConfigRepository.js";
import type { RuntimeState } from "../../schemas/runtimeStateSchemas.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";

/** 观察结果：ok 表示提取成功；delta 为校验通过的增量；warning 为失败原因（可空）。 */
export interface ChapterObservation {
  ok: boolean;
  delta?: StateDelta;
  warning?: string;
}

/** 观察者系统提示词：明确只输出增量、不编造正文中没有的变化。 */
const observerSystemPrompt = [
  "你是小说状态观察者。根据章节正文，输出对作品权威状态的增量更新（JSON delta）。",
  "规则：",
  "- 只输出 book-state-delta.v1 JSON 对象，不要输出任何解释文字",
  "- characterStates / factionStates / itemStates：状态发生明确变化时才输出对应条目（characterId/factionId/itemId + 最新状态），未变化不要输出",
  "- foreshadowing：正文中伏笔被投放、推进或回收时输出对应条目，id 必须与【当前权威状态】中已有伏笔 id 一致，status 只能沿 planned → planted → resolving → resolved 方向推进，lastAdvancedChapter 填当前章节号",
  "- summary：用 1-2 句话概括本章推进的情节、情绪或伏笔动作",
  "- entities：本章实际出现或产生影响的实体 id 列表（来自正文，不要发明）",
  "- 严禁输出正文中不存在的变化，严禁改写与正文无关的状态"
].join("\n");

/**
 * 从章节正文提取状态增量。
 * @param chapter 章节信息（title/outline/content——content 来自正文文件，不在章节索引记录中）
 * @param runtimeState 当前权威状态（用于提供现有伏笔/状态清单）
 * @returns 校验通过的 delta；模型不可用、调用失败或校验失败返回 { ok: false }
 */
export async function observeChapterState(
  workspacePaths: WorkspacePaths,
  bookId: string,
  chapter: { title: string; outline: string; content: string },
  runtimeState: RuntimeState
): Promise<ChapterObservation> {
  const routes = await getModelRoutes(workspacePaths);
  if (!routes.writingModelId) return { ok: false, warning: "写作模型未配置，跳过状态观察" };
  const model = await getModelConfig(workspacePaths, routes.writingModelId);
  if (!model.enabled) return { ok: false, warning: "写作模型已停用，跳过状态观察" };

  // 权威状态摘要：只给观察者必要清单（伏笔 id/内容/状态 + 角色/物品状态），避免全文注入
  const stateBrief = {
    characterStates: runtimeState.state.characterStates,
    itemStates: runtimeState.state.itemStates,
    foreshadowing: runtimeState.state.foreshadowing.map((item) => ({
      id: item.id,
      content: item.content,
      status: item.status
    }))
  };
  const userPrompt = [
    `【当前权威状态】`,
    JSON.stringify(stateBrief),
    "",
    `【章节信息】`,
    `标题：${chapter.title}`,
    `细纲：${chapter.outline || "未提供"}`,
    "",
    `【章节正文】`,
    // 保留尾部（近期内容优先）：长章节中本章新发生的事集中在后半段
    (chapter.content ?? "").slice(-8_000) || "（正文为空）",
    "",
    "只输出 JSON。"
  ].join("\n");

  try {
    const result = await generateModelText(workspacePaths, model, {
      systemPrompt: observerSystemPrompt,
      userPrompt,
      temperature: 0.1,
      maxTokens: 2_000,
      responseFormat: "json_object",
      timeoutMs: 90_000
    });
    const parsed = parseDelta(result.text);
    if (!parsed.success) return { ok: false, warning: `状态增量校验失败：${parsed.error}` };
    // 业务校验：伏笔 id 必须存在且状态只能沿 planned→planted→resolving→resolved 单向推进，
    // 防止模型"发明伏笔"或把已回收伏笔回退（确定性兜底，不依赖模型自觉）
    const issues = validateStateDeltaAgainstCurrent(parsed.data, runtimeState);
    if (issues.length > 0) return { ok: false, warning: `状态增量业务校验失败：${issues.join("；")}` };
    return { ok: true, delta: parsed.data };
  } catch (error) {
    return { ok: false, warning: `状态观察调用失败：${error instanceof Error ? error.message : String(error)}` };
  }
}

/** 伏笔状态机的合法推进顺序（只允许单向前进）。 */
const foreshadowingStatusOrder = ["planned", "planted", "resolving", "resolved"] as const;

/**
 * 校验 delta 与当前权威状态的业务一致性（纯函数，便于单测）：
 * 1. 伏笔 id 必须已存在于当前状态（禁止发明新伏笔）；
 * 2. 伏笔状态只能沿 planned → planted → resolving → resolved 单向推进（禁止回退）；
 * 3. 伏笔推进章节号只能单调递增（禁止回退）。
 * 返回问题列表；空数组表示通过。
 */
export function validateStateDeltaAgainstCurrent(delta: StateDelta, runtimeState: RuntimeState): string[] {
  const issues: string[] = [];
  const currentForeshadowing = new Map(runtimeState.state.foreshadowing.map((item) => [item.id, item]));
  const statusIndex = new Map(foreshadowingStatusOrder.map((status, index) => [status, index]));

  for (const item of delta.foreshadowing ?? []) {
    const existing = currentForeshadowing.get(item.id);
    if (!existing) {
      issues.push(`伏笔 ${item.id} 不存在于当前状态，禁止新增`);
      continue;
    }
    const from = statusIndex.get(existing.status) ?? -1;
    const to = statusIndex.get(item.status) ?? -1;
    if (to < from) {
      issues.push(`伏笔 ${item.id} 状态不能回退：${existing.status} → ${item.status}`);
    }
    if (
      item.lastAdvancedChapter !== null
      && existing.lastAdvancedChapter !== null
      && item.lastAdvancedChapter < existing.lastAdvancedChapter
    ) {
      issues.push(`伏笔 ${item.id} 推进章节号不能回退：${existing.lastAdvancedChapter} → ${item.lastAdvancedChapter}`);
    }
  }
  return issues;
}

/** 从模型输出中提取并校验 JSON delta。 */
function parseDelta(text: string): { success: true; data: StateDelta } | { success: false; error: string } {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < start) return { success: false, error: "响应中没有 JSON 对象" };
    return { success: true, data: stateDeltaSchema.parse(JSON.parse(text.slice(start, end + 1))) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

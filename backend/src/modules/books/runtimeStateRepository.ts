/**
 * 作品运行时状态仓库：runtime.json 的读写、状态增量应用/回滚与 Markdown 投影渲染。
 *
 * 三层记忆架构的本地实现（借鉴 InkOS）：
 * 1. state/runtime.json —— 结构化权威状态（baseline + 各章 delta + 合成 state），Zod 严格校验；
 * 2. state/current.md、state/foreshadowing.md —— 人类可读投影（由权威状态渲染，非事实源）；
 * 3. 章节保存后 Observer 输出 JSON delta，代码层 immutable 应用并重放合成新状态，
 *    删除章节时按 delta 序列回滚（排除被删章节的记录），坏数据直接拒绝不落盘。
 */
import path from "node:path";
import {
  runtimeStateSchema,
  runtimeStateViewSchema,
  type RuntimeForeshadowing,
  type RuntimeState,
  type RuntimeStateDeltaRecord,
  type RuntimeStateView,
  type StateDelta
} from "../../schemas/runtimeStateSchemas.js";
import type { BookEntityRecord } from "../../types/domain.js";
import { reconcileForeshadowingSchedule } from "./foreshadowingScheduler.js";
import { pathExists, readTextFile, writeTextFileAtomic } from "../../utils/fileStore.js";
import { writeJsonFile } from "../../utils/jsonStore.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { createBookPaths } from "./bookPaths.js";

/** 伏笔状态英文枚举到中文展示名的映射，用于伏笔池投影表格。 */
const foreshadowingStatusLabels: Record<string, string> = {
  planned: "已规划",
  planted: "已埋设",
  advancing: "推进中",
  resolving: "回收中",
  resolved: "已回收",
  archived: "已归档"
};

/**
 * 渲染用视图类型：与权威状态同构，但允许伏笔缺少 lastAdvancedChapter——
 * 兼容初始化 Bundle 的 StateBundle（该字段在初始化时不存在，由 baseline 写入时补默认值）。
 */
export type RuntimeStateRenderView = Omit<RuntimeStateView, "foreshadowing"> & {
  foreshadowing: Array<Omit<RuntimeForeshadowing, "lastAdvancedChapter" | "horizon" | "targetChapterRange"> & {
    lastAdvancedChapter?: number | null;
    horizon?: "short" | "long";
    targetChapterRange?: { start: number; end: number } | null;
  }>;
};

/** 读取运行时权威状态；文件缺失或校验失败返回 null（未初始化或数据损坏）。 */
export async function readRuntimeState(workspacePaths: WorkspacePaths, bookId: string): Promise<RuntimeState | null> {
  const filePath = createBookPaths(workspacePaths, bookId).runtimeStateFile;
  if (!(await pathExists(filePath))) return null;
  try {
    const parsed = runtimeStateSchema.safeParse(JSON.parse(await readTextFile(filePath)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** 整体写入运行时权威状态。 */
export async function writeRuntimeState(workspacePaths: WorkspacePaths, bookId: string, state: RuntimeState): Promise<void> {
  await writeJsonFile(createBookPaths(workspacePaths, bookId).runtimeStateFile, state);
}

/** 从初始化 Bundle 状态创建 baseline：入参经 schema 校验并补默认字段（如 lastAdvancedChapter）。 */
export function createBaselineRuntimeState(view: unknown): RuntimeState {
  const parsed = runtimeStateViewSchema.parse(view);
  return {
    schemaVersion: "book-runtime-state.v1",
    baseline: parsed,
    deltas: [],
    history: [],
    state: parsed,
    chapterSummaries: {}
  };
}

/**
 * 把某章的 delta 应用到权威状态：覆盖/追加记录后从 baseline 全量重放。
 * 同章重新观察必须走该语义，避免旧 delta 写入但新 delta 未包含的字段残留在合成状态中。
 * 纯函数（不落盘），调用方负责 writeRuntimeState 持久化。
 */
export function applyStateDelta(state: RuntimeState, chapterId: string, delta: StateDelta): RuntimeState {
  return replaceChapterDelta(state, chapterId, delta);
}

/** 替换或追加某章 delta，并从 baseline 重建最终状态、历史快照与章节摘要。 */
export function replaceChapterDelta(state: RuntimeState, chapterId: string, delta: StateDelta): RuntimeState {
  const legacyChapterNo = inferChapterNo(chapterId, state.deltas.length + 1);
  return replaceChapterStateEvent(state, {
    chapterId,
    chapterNo: legacyChapterNo,
    chapterRevision: 1,
    observationRevision: 1,
    contentHash: "legacy",
    recordedAt: new Date(0).toISOString(),
    delta
  });
}

/** 按明确的故事顺序替换章节事件，重放不再依赖观察完成或写入先后。 */
export function replaceChapterStateEvent(state: RuntimeState, event: RuntimeStateDeltaRecord): RuntimeState {
  const nextDeltas = [...state.deltas];
  const deltaIndex = nextDeltas.findIndex((record) => record.chapterId === event.chapterId);
  if (deltaIndex >= 0) nextDeltas[deltaIndex] = event;
  else nextDeltas.push(event);
  const orderedDeltas = sortStateEvents(nextDeltas);
  const rebuilt = rebuildHistoryStack(state.baseline, orderedDeltas);
  const chapterSummaries = buildChapterSummaries(orderedDeltas);

  return {
    schemaVersion: "book-runtime-state.v1",
    baseline: state.baseline,
    deltas: orderedDeltas,
    history: rebuilt.history,
    state: rebuilt.finalView,
    chapterSummaries
  };
}

/**
 * 按 delta 序列重放合成权威状态；excludeChapterId 用于删除章节回滚。
 * 重放 = 从 baseline 深拷贝后逐条应用（upsert 语义），保持不可变更新。
 */
export function replayRuntimeState(baseline: RuntimeStateView, deltas: RuntimeStateDeltaRecord[], excludeChapterId?: string): RuntimeStateView {
  const next: RuntimeStateView = structuredClone(baseline);
  for (const record of sortStateEvents(deltas)) {
    if (record.chapterId === excludeChapterId) continue;
    applyDeltaToView(next, record.delta, record.chapterNo);
  }
  return next;
}

/** 替换人工维护的 baseline，并完整重放既有章节事件，保持历史、摘要和合成状态相互一致。 */
export function replaceRuntimeBaseline(state: RuntimeState, baseline: RuntimeStateView): RuntimeState {
  const parsedBaseline = runtimeStateViewSchema.parse(baseline);
  const orderedDeltas = sortStateEvents(state.deltas);
  const rebuilt = rebuildHistoryStack(parsedBaseline, orderedDeltas);
  return runtimeStateSchema.parse({
    schemaVersion: "book-runtime-state.v1",
    baseline: parsedBaseline,
    deltas: orderedDeltas,
    history: rebuilt.history,
    state: rebuilt.finalView,
    chapterSummaries: buildChapterSummaries(orderedDeltas)
  });
}

/**
 * 删除章节回滚：移除该章的 delta 与摘要，并从 baseline 按剩余 delta 序列**重建历史快照栈**，
 * 得到回滚后的权威状态（删除是低频操作，一次 O(n) 重建可接受）。
 * 说明：历史快照栈中后续章节的快照引用了含被删章的状态，直接复用会导致状态错乱，
 * 因此删除时整体重建（跳过被删章）。
 */
export function removeChapterDelta(state: RuntimeState, chapterId: string): RuntimeState {
  const deltas = state.deltas.filter((record) => record.chapterId !== chapterId);
  const rebuilt = rebuildHistoryStack(state.baseline, deltas);
  const chapterSummaries = { ...state.chapterSummaries };
  delete chapterSummaries[chapterId];
  return {
    schemaVersion: "book-runtime-state.v1",
    baseline: state.baseline,
    deltas,
    history: rebuilt.history,
    state: rebuilt.finalView,
    chapterSummaries
  };
}

/** 从某章起移除全部事件；旧章改写后，下游观察结果不能继续视为有效。 */
export function invalidateChapterDeltasFrom(state: RuntimeState, chapterNo: number, exceptChapterId?: string): RuntimeState {
  const deltas = state.deltas.filter((record) => record.chapterNo < chapterNo || record.chapterId === exceptChapterId);
  const rebuilt = rebuildHistoryStack(state.baseline, deltas);
  return {
    schemaVersion: "book-runtime-state.v1",
    baseline: state.baseline,
    deltas,
    history: rebuilt.history,
    state: rebuilt.finalView,
    chapterSummaries: buildChapterSummaries(deltas)
  };
}

/** 从 baseline 按 delta 序列逐章增量应用，构造历史快照栈与最终状态（删除回滚时使用）。 */
function rebuildHistoryStack(baseline: RuntimeStateView, deltas: RuntimeStateDeltaRecord[]) {
  const view = structuredClone(baseline);
  const history: Array<{ chapterId: string; chapterNo: number; chapterRevision: number; snapshot: RuntimeStateView }> = [];
  for (const record of sortStateEvents(deltas)) {
    history.push({ chapterId: record.chapterId, chapterNo: record.chapterNo, chapterRevision: record.chapterRevision, snapshot: structuredClone(view) });
    applyDeltaToView(view, record.delta, record.chapterNo);
  }
  return { history: history.slice(-50), finalView: view };
}

function buildChapterSummaries(deltas: RuntimeStateDeltaRecord[]) {
  const summaries: Record<string, string> = {};
  for (const record of deltas) {
    if (record.delta.summary) summaries[record.chapterId] = record.delta.summary;
  }
  return summaries;
}

function sortStateEvents(deltas: RuntimeStateDeltaRecord[]) {
  return [...deltas].sort((left, right) =>
    left.chapterNo - right.chapterNo
    || left.chapterId.localeCompare(right.chapterId)
    || left.chapterRevision - right.chapterRevision
    || left.observationRevision - right.observationRevision
  );
}

function inferChapterNo(chapterId: string, fallback: number) {
  const match = chapterId.match(/chapter-(\d+)/);
  return match ? Math.max(1, Number(match[1])) : Math.max(1, fallback);
}

/** 把单条 delta 应用到状态视图（upsert：按 id 覆盖或新增）。 */
function applyDeltaToView(view: RuntimeStateView, delta: StateDelta, chapterNo?: number) {
  for (const item of delta.characterStates ?? []) {
    const index = view.characterStates.findIndex((entry) => entry.characterId === item.characterId);
    if (index >= 0) view.characterStates[index] = item;
    else view.characterStates.push(item);
  }
  for (const item of delta.factionStates ?? []) {
    const index = view.factionStates.findIndex((entry) => entry.factionId === item.factionId);
    if (index >= 0) view.factionStates[index] = item;
    else view.factionStates.push(item);
  }
  for (const item of delta.itemStates ?? []) {
    const index = view.itemStates.findIndex((entry) => entry.itemId === item.itemId);
    if (index >= 0) view.itemStates[index] = item;
    else view.itemStates.push(item);
  }
  for (const item of delta.foreshadowing ?? []) {
    const index = view.foreshadowing.findIndex((entry) => entry.id === item.id);
    if (index >= 0) view.foreshadowing[index] = mergeForeshadowing(view.foreshadowing[index], item);
    else view.foreshadowing.push(item);
  }
  if (chapterNo !== undefined) {
    view.foreshadowing = reconcileForeshadowingSchedule(
      view.foreshadowing,
      chapterNo,
      new Set((delta.foreshadowing ?? []).map((item) => item.id))
    );
  }
}

const foreshadowingStatusOrder = ["planned", "planted", "advancing", "resolving", "resolved", "archived"] as const;

/**
 * 重放时伏笔只允许向前推进，并让 baseline 中人工维护的稳定描述优先于历史 delta 的旧副本。
 * 这样修改 baseline 后重放章节事件不会把内容、计划或关联实体改回旧值，也不会发生状态倒退。
 */
function mergeForeshadowing(existing: RuntimeForeshadowing, observed: RuntimeForeshadowing): RuntimeForeshadowing {
  const existingStatus = foreshadowingStatusOrder.indexOf(existing.status);
  const observedStatus = foreshadowingStatusOrder.indexOf(observed.status);
  return {
    ...observed,
    content: existing.content,
    relatedEntityIds: existing.relatedEntityIds,
    placement: existing.placement,
    resolution: existing.resolution,
    horizon: existing.horizon ?? observed.horizon,
    targetChapterRange: existing.targetChapterRange ?? observed.targetChapterRange,
    status: foreshadowingStatusOrder[Math.max(existingStatus, observedStatus)],
    lastAdvancedChapter: Math.max(existing.lastAdvancedChapter ?? 0, observed.lastAdvancedChapter ?? 0) || null
  };
}

/**
 * 渲染 current.md 投影：从权威状态视图生成人类可读的当前状态文档。
 * 原实现位于初始化服务，现统一收敛到仓库（权威状态唯一，投影只读渲染）。
 */
export function renderCurrentStateMarkdown(view: RuntimeStateRenderView) {
  const list = (items: string[]) => items.length ? items.map((item) => `- ${item}`).join("\n") : "- 无";
  const characterStates = view.characterStates
    .map((item) => `- **${item.characterId}**：${item.state}`)
    .join("\n");
  const factionStates = view.factionStates
    .map((item) => `- **${item.factionId}**：${item.state}`)
    .join("\n");
  const itemStates = view.itemStates
    .map((item) => `- **${item.itemId}**：${item.state}`)
    .join("\n");
  return `# 当前状态\n\n## 故事起点\n${view.storyStart}\n\n## 已公开信息\n${list(view.publicFacts)}\n\n## 未公开秘密\n${list(view.secrets)}\n\n## 下一阶段目标\n${list(view.nextGoals)}\n\n## 人物状态\n${characterStates}\n\n## 势力状态\n${factionStates}\n\n## 物品状态\n${itemStates}\n`;
}

/** 表格单元格转义：竖线与换行替换为可安全放入表格的形式。 */
function escapeTable(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function renderTargetChapterRange(value: RuntimeForeshadowing["targetChapterRange"]) {
  return value ? `第 ${value.start}${value.end === value.start ? "" : `-${value.end}`} 章` : "未结构化";
}

/** 关联实体列渲染：把拼音 id 翻译为「名称（id）」，未知 id 原样保留便于排查。 */
function renderRelatedEntities(relatedEntityIds: string[], entityNames: Map<string, string>) {
  return relatedEntityIds
    .map((id) => {
      const name = entityNames.get(id);
      return name ? `${name}（${id}）` : id;
    })
    .join("、");
}

/** 渲染 foreshadowing.md 投影：从权威状态视图生成伏笔池表格（实体 id 翻译为中文名）。 */
export function renderForeshadowingMarkdown(view: RuntimeStateRenderView, entityNames: Map<string, string>) {
  return `# 伏笔池\n\n| ID | 伏笔 | 类型 | 关联实体 | 投放计划 | 回收计划 | 目标章节 | 状态 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n${view.foreshadowing.map((item) => `| ${item.id} | ${escapeTable(item.content)} | ${item.horizon === "long" ? "长线" : "短线"} | ${renderRelatedEntities(item.relatedEntityIds, entityNames)} | ${escapeTable(item.placement)} | ${escapeTable(item.resolution)} | ${renderTargetChapterRange(item.targetChapterRange)} | ${foreshadowingStatusLabels[item.status] ?? item.status} |`).join("\n")}\n`;
}

/** 从实体记录列表构建 id → 名称映射（供伏笔池投影翻译）。 */
export function buildEntityNameMap(entities: BookEntityRecord[]) {
  const names = new Map<string, string>();
  for (const entity of entities) {
    names.set(entity.id, entity.name);
  }
  return names;
}

/** 从权威状态渲染并落盘两份 Markdown 投影（current.md / foreshadowing.md）。 */
export async function writeStateProjections(workspacePaths: WorkspacePaths, bookId: string, state: RuntimeState, entityNames: Map<string, string>) {
  const bookPaths = createBookPaths(workspacePaths, bookId);
  await writeTextFileAtomic(bookPaths.currentStateFile, renderCurrentStateMarkdown(state.state));
  await writeTextFileAtomic(bookPaths.foreshadowingFile, renderForeshadowingMarkdown(state.state, entityNames));
}

/** 控制文档路径（author_intent / current_focus）：属于 state 目录下的长期意图文件。 */
export function stateControlFilePaths(workspacePaths: WorkspacePaths, bookId: string) {
  const bookPaths = createBookPaths(workspacePaths, bookId);
  return {
    authorIntent: bookPaths.authorIntentFile,
    currentFocus: bookPaths.currentFocusFile
  };
}

/** 读取控制文档内容；缺失时返回空串。 */
export async function readControlFile(filePath: string) {
  return (await pathExists(filePath)) ? await readTextFile(filePath) : "";
}

/** 写入控制文档（author_intent / current_focus）。 */
export async function writeControlFile(filePath: string, content: string) {
  await writeTextFileAtomic(filePath, content);
}

/** 控制文档绝对路径 → 相对作品目录的展示路径（不含作品 id）。 */
export function controlFileRelativeName(filePath: string, workspacePaths: WorkspacePaths, bookId: string) {
  const bookDir = createBookPaths(workspacePaths, bookId).bookDir;
  return path.relative(bookDir, filePath).replaceAll("\\", "/");
}

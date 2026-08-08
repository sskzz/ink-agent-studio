/**
 * 故事线服务：汇总作品主/阶段性剧情进度、当前章节位置、短期伏笔与角色状态，
 * 供编辑器左侧"故事线"功能栏展示。数据来自书籍最新状态（runtime.json 权威状态）与章节索引。
 */
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { getBook } from "./bookRepository.js";
import { listChapters } from "./chapterService.js";
import { buildEntityNameMap, readRuntimeState } from "./runtimeStateRepository.js";
import { listEntities } from "./entityService.js";

/** 未回收的短期伏笔（planned/planted/resolving，排除已 resolved）。 */
export const ACTIVE_FORESHADOWING_STATUSES = ["planned", "planted", "resolving"] as const;
export type ActiveForeshadowingStatus = (typeof ACTIVE_FORESHADOWING_STATUSES)[number];
export type ForeshadowingStatus = ActiveForeshadowingStatus | "resolved";

/** 阶段剧情进度：卷 / 章 维度的推进位置。 */
export interface StorylineStageProgress {
  /** 当前章节所在卷号；无章节时为 0。 */
  volume: number;
  /** 全卷总数。 */
  volumeTotal: number;
  /** 当前章节号；无章节时为 0。 */
  chapterNo: number;
  /** 全书章节总数。 */
  chapterTotal: number;
  /** 当前卷内章节序号（该卷第几章）。 */
  chapterInVolume: number;
}

/** 故事线 DTO：一次返回五类信息，前端直接渲染。 */
export interface StorylineDto {
  /** 主体剧情进度：起点 + 下一阶段目标 + 最近三章推进摘要。 */
  mainProgress: string[];
  /** 阶段性剧情进度：卷/章位置。 */
  stageProgress: StorylineStageProgress;
  /** 当前章节位于主体剧情与阶段性剧情的位置描述。 */
  currentPosition: { main: string; stage: string };
  /** 当前章节所埋的短期伏笔（未回收条目）。 */
  shortForeshadowing: Array<{ id: string; content: string; status: ForeshadowingStatus }>;
  /** 各角色目前状态（带角色名映射）。 */
  characterStates: Array<{ characterId: string; name: string; state: string }>;
}

/** 汇总一本书的故事线快照。作品不存在时由 getBook 抛出 404。 */
export async function getBookStoryline(workspacePaths: WorkspacePaths, bookId: string): Promise<StorylineDto> {
  const [book, chapters, runtime] = await Promise.all([
    getBook(workspacePaths, bookId),
    listChapters(workspacePaths, bookId),
    readRuntimeState(workspacePaths, bookId)
  ]);
  const state = runtime?.state ?? null;
  const summaries = runtime?.chapterSummaries ?? {};

  const sortedChapters = [...chapters].sort((left, right) => left.volumeNo - right.volumeNo || left.chapterNo - right.chapterNo);
  const recentSummaries = sortedChapters
    .slice(-3)
    .map((chapter) => ({ chapterNo: chapter.chapterNo, title: chapter.title, summary: summaries[chapter.id] ?? "" }))
    .filter((item) => Boolean(item.summary.trim()));

  const mainProgress: string[] = [];
  if (state?.storyStart) mainProgress.push(`起点：${state.storyStart}`);
  if (state?.nextGoals && state.nextGoals.length > 0) {
    mainProgress.push(`下一阶段目标：${state.nextGoals.join("；")}`);
  }
  if (recentSummaries.length > 0) {
    mainProgress.push(...recentSummaries.map((item) => `第 ${item.chapterNo} 章（${item.title}）：${item.summary}`));
  }
  if (mainProgress.length === 0) mainProgress.push("（尚未初始化剧情状态，生成并保存章节后将自动记录进度）");

  const volumeTotal = new Set(sortedChapters.map((chapter) => chapter.volumeNo)).size;
  const chapterTotal = sortedChapters.length;
  const current = sortedChapters.at(-1) ?? null;
  const chapterInVolume = current
    ? sortedChapters.filter((chapter) => chapter.volumeNo === current!.volumeNo).length
    : 0;

  const vInVolume = current
    ? sortedChapters.filter((chapter) => chapter.volumeNo === current!.volumeNo).findIndex((chapter) => chapter.id === current!.id) + 1
    : 0;

  const stageProgress: StorylineStageProgress = {
    volume: current?.volumeNo ?? 0,
    volumeTotal: volumeTotal || 1,
    chapterNo: current?.chapterNo ?? 0,
    chapterTotal: chapterTotal,
    chapterInVolume: vInVolume
  };

  const currentPosition = current
    ? {
        main: `全书共 ${chapterTotal} 章，当前处于第 ${current.chapterNo} 章「${current.title}」（${chapterTotal === 0 ? "0" : Math.max(1, Math.round(stageProgress.chapterNo / Math.max(stageProgress.chapterTotal, 1) * 100))}% 位置）${recentSummaries.length > 0 ? `，最近推进：${recentSummaries.at(-1)!.summary}` : ""}`,
        stage: `当前处于第 ${current.volumeNo} 卷，本章为该卷第 ${vInVolume} / ${chapterInVolume} 章${sortedChapters.length > 1 ? `；全书已写完 ${sortedChapters.length} 章` : ""}`
      }
    : { main: "尚未创建章节", stage: "创建第一个章节后开始记录剧情位置" };

  const entities = await listEntities(workspacePaths, bookId);
  const nameMap = buildEntityNameMap(entities);
  const characterStates = (state?.characterStates ?? []).map((entry) => ({
    characterId: entry.characterId,
    name: nameMap.get(entry.characterId) ?? entry.characterId,
    state: entry.state
  }));
  const shortForeshadowing = (state?.foreshadowing ?? [])
    .filter((item) => (ACTIVE_FORESHADOWING_STATUSES as readonly string[]).includes(item.status))
    .map((item) => ({ id: item.id, content: item.content, status: item.status }));

  return {
    mainProgress,
    stageProgress,
    currentPosition,
    characterStates,
    shortForeshadowing
  };
}

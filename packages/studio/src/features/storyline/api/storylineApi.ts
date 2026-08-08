/**
 * 故事线 API：编辑器左侧"故事线"功能栏的数据来源（对应后端 routes/books.ts 的
 * GET /books/:bookId/storyline）。返回主体/阶段剧情进度、当前章节位置、
 * 当前章节所埋短期伏笔与各角色状态。
 */
import { apiGet } from "@/shared/api/http";

/** 短期伏笔状态：规划中 / 已植入 / 回收中 / 已回收。 */
export type StorylineForeshadowingStatus = "planned" | "planted" | "resolving" | "resolved";

/** 阶段剧情进度：卷 / 章 维度的推进位置。 */
export interface StorylineStageProgress {
  volume: number;
  volumeTotal: number;
  chapterNo: number;
  chapterTotal: number;
  /** 当前卷内章节序号（该卷第几章）。 */
  chapterInVolume: number;
}

/** 故事线快照：五类信息一次返回。 */
export interface StorylineData {
  /** 主体剧情进度：起点 + 下一阶段目标 + 最近三章推进摘要。 */
  mainProgress: string[];
  stageProgress: StorylineStageProgress;
  /** 当前章节位于主体剧情与阶段性剧情的位置描述。 */
  currentPosition: { main: string; stage: string };
  /** 当前章节所埋的短期伏笔（未回收条目）。 */
  shortForeshadowing: Array<{ id: string; content: string; status: StorylineForeshadowingStatus }>;
  /** 各角色目前状态。 */
  characterStates: Array<{ characterId: string; name: string; state: string }>;
}

/** 拉取作品故事线快照；作品不存在时后端返回 404。 */
export async function getBookStoryline(bookId: string): Promise<StorylineData> {
  return apiGet<StorylineData>(`/books/${bookId}/storyline`);
}

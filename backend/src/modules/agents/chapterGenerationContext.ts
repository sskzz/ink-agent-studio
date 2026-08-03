import { readTextFile } from "../../utils/fileStore.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { createBookPaths } from "../books/bookPaths.js";

/** 章节生成所需的四份权威事实源内容：故事基石、世界观、当前状态、伏笔池。 */
export interface ChapterFactContext {
  brief: string;
  world: string;
  currentState: string;
  foreshadowing: string;
}

/**
 * 读取章节生成所需权威事实源（文件职责）。
 * 入参：paths——工作区路径；bookId——目标作品。
 * 返回值：四份 Markdown 原文。
 * 说明：这里只负责读文件；具体 Token 预算与分片注入策略由 PromptAssembler 统一执行和记录。
 */
export async function loadChapterFactContext(paths: WorkspacePaths, bookId: string): Promise<ChapterFactContext> {
  const bookPaths = createBookPaths(paths, bookId);
  // 并行读取四份核心文件，任一缺失会抛出异常（调用方按事实源不可用处理）。
  const [brief, world, currentState, foreshadowing] = await Promise.all([
    readTextFile(bookPaths.briefFile),
    readTextFile(bookPaths.worldFile),
    readTextFile(bookPaths.currentStateFile),
    readTextFile(bookPaths.foreshadowingFile)
  ]);
  return { brief, world, currentState, foreshadowing };
}

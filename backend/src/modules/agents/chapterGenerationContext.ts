import { readTextFile } from "../../utils/fileStore.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { createBookPaths } from "../books/bookPaths.js";

export interface ChapterFactContext {
  brief: string;
  world: string;
  currentState: string;
  foreshadowing: string;
}

/** 读取章节生成所需权威事实源；具体 Token 预算由 PromptAssembler 统一执行和记录。 */
export async function loadChapterFactContext(paths: WorkspacePaths, bookId: string): Promise<ChapterFactContext> {
  const bookPaths = createBookPaths(paths, bookId);
  const [brief, world, currentState, foreshadowing] = await Promise.all([
    readTextFile(bookPaths.briefFile),
    readTextFile(bookPaths.worldFile),
    readTextFile(bookPaths.currentStateFile),
    readTextFile(bookPaths.foreshadowingFile)
  ]);
  return { brief, world, currentState, foreshadowing };
}

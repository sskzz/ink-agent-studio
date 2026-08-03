import { completeRun, createRunRecord } from "./runRepository.js";
import { getBook, saveBook } from "../books/bookRepository.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";

/**
 * 旧版确定性作品初始化（文件职责）。
 * 说明：这是接入规划模型流水线（initializeBookWithAi）之前的过渡实现，只做字段兜底填充，
 * 不调用模型；新建作品仍可用它生成可读的基础记录，真实设定由后续 AI 初始化覆盖。
 */
export async function initializeBook(workspacePaths: WorkspacePaths, bookId: string, body: unknown) {
  const book = await getBook(workspacePaths, bookId);
  const run = createRunRecord({ bookId, runType: "create_book", inputJson: body });
  // 未填字段全部给出确定性兜底值，保证后续读端（作品详情、编辑器）不出现空字段。
  const initialized = {
    ...book,
    title: book.title || "AI 生成作品名",
    genre: book.genre || "AI 推断题材",
    narrationPerspective: book.narrationPerspective || "第三人称",
    channel: book.channel || "男频",
    protagonistGender: book.protagonistGender || "待 AI 生成",
    protagonistName: book.protagonistName || "待 AI 生成",
    plannedWords: book.plannedWords ?? 300000,
    chapterWords: book.chapterWords ?? 3000,
    needsAiFill: [],
    updatedAt: new Date().toISOString()
  };
  await saveBook(workspacePaths, initialized);
  return completeRun(workspacePaths, run, {
    book: initialized,
    generatedFiles: ["brief.md", "outline.md", "world.md", "state/current.md", "state/foreshadowing.md"],
    note: "当前为确定性初始化结果，后续接入规划模型生成真实内容。"
  });
}

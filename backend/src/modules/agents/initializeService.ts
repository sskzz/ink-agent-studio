import { completeRun, createRunRecord } from "./runRepository.js";
import { getBook, saveBook } from "../books/bookRepository.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";

export async function initializeBook(workspacePaths: WorkspacePaths, bookId: string, body: unknown) {
  const book = await getBook(workspacePaths, bookId);
  const run = createRunRecord({ bookId, runType: "create_book", inputJson: body });
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

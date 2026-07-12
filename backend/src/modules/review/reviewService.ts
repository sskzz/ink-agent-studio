import { chapterAiTaskInputSchema } from "../../schemas/chapterSchemas.js";
import { completeRun, createRunRecord } from "../agents/runRepository.js";
import { getBook } from "../books/bookRepository.js";
import { getChapter } from "../books/chapterService.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";

export async function reviewChapter(workspacePaths: WorkspacePaths, bookId: string, chapterId: string, body: unknown) {
  const input = chapterAiTaskInputSchema.parse(body);
  const chapter = await getChapter(workspacePaths, bookId, chapterId);
  const run = createRunRecord({ bookId, runType: "review", inputJson: { chapterId, ...input } });
  return completeRun(workspacePaths, run, {
    chapterId,
    report: [
      "检查人物行为是否符合既有设定。",
      "检查是否有重复解释、空泛情绪词和过度总结。",
      `当前章节字数约 ${chapter.wordCount}，后续可结合目标字数继续扩写。`
    ]
  });
}

export async function polishChapter(workspacePaths: WorkspacePaths, bookId: string, chapterId: string, body: unknown) {
  const input = chapterAiTaskInputSchema.parse(body);
  const chapter = await getChapter(workspacePaths, bookId, chapterId);
  const run = createRunRecord({ bookId, runType: "anti_ai_polish", inputJson: { chapterId, ...input } });
  return completeRun(workspacePaths, run, {
    chapterId,
    suggestions: [
      "减少直接解释心理，改用动作、物件和环境反馈。",
      "避免段尾替读者总结情绪。",
      "保留人物不完全说破的信息差。"
    ],
    preview: chapter.content.replace(/非常|特别|突然/g, "")
  });
}

export async function consistencyCheck(workspacePaths: WorkspacePaths, bookId: string, body: unknown) {
  const input = chapterAiTaskInputSchema.parse(body);
  const book = await getBook(workspacePaths, bookId);
  const run = createRunRecord({ bookId, runType: "consistency_check", inputJson: input });
  return completeRun(workspacePaths, run, {
    bookId,
    checks: [
      `作品「${book.title}」当前主角为「${book.protagonistName || "待补全"}」。`,
      "后续需要读取 state/current.md 和 foreshadowing.md 做更细连续性检查。",
      "当前第一版为规则检查占位，已预留真实模型接入点。"
    ]
  });
}

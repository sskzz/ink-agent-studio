import { randomUUID } from "node:crypto";
import {
  chapterAiTaskInputSchema,
  chapterCreateInputSchema,
  chaptersIndexSchema,
  chapterUpdateInputSchema
} from "../../schemas/chapterSchemas.js";
import type { ChapterRecord } from "../../types/domain.js";
import { notFound } from "../../utils/errors.js";
import { readTextFile, writeTextFileAtomic } from "../../utils/fileStore.js";
import { readJsonFile, writeJsonFile } from "../../utils/jsonStore.js";
import { resolveInsideRoot } from "../../utils/safePath.js";
import { completeRun, createRunRecord } from "../agents/runRepository.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { createBookPaths } from "./bookPaths.js";
import { getBook, saveBook } from "./bookRepository.js";

function countWords(content: string) {
  return content.replace(/\s+/g, "").length;
}

async function readChapters(workspacePaths: WorkspacePaths, bookId: string) {
  await getBook(workspacePaths, bookId);
  return readJsonFile(createBookPaths(workspacePaths, bookId).chaptersIndexFile, chaptersIndexSchema, []);
}

async function writeChapters(workspacePaths: WorkspacePaths, bookId: string, chapters: ChapterRecord[]) {
  await writeJsonFile(createBookPaths(workspacePaths, bookId).chaptersIndexFile, chapters);
}

function chapterPath(workspacePaths: WorkspacePaths, bookId: string, chapter: ChapterRecord) {
  return resolveInsideRoot(createBookPaths(workspacePaths, bookId).chaptersDir, `${chapter.id}.md`);
}

export async function listChapters(workspacePaths: WorkspacePaths, bookId: string) {
  return readChapters(workspacePaths, bookId);
}

export async function createChapter(workspacePaths: WorkspacePaths, bookId: string, body: unknown) {
  const input = chapterCreateInputSchema.parse(body);
  const chapters = await readChapters(workspacePaths, bookId);
  const now = new Date().toISOString();
  const chapterNo = input.chapterNo ?? chapters.length + 1;
  const id = `chapter-${String(chapterNo).padStart(4, "0")}-${randomUUID().slice(0, 8)}`;
  const content = input.content || `# ${input.title}\n\n待继续写作。\n`;
  const chapter: ChapterRecord = {
    id,
    bookId,
    volumeNo: input.volumeNo,
    chapterNo,
    title: input.title,
    fileId: id,
    wordCount: countWords(content),
    status: "drafting",
    outline: input.outline,
    summary: "",
    createdAt: now,
    updatedAt: now
  };

  await writeTextFileAtomic(chapterPath(workspacePaths, bookId, chapter), content);
  await writeChapters(workspacePaths, bookId, [...chapters, chapter]);
  await updateBookProgress(workspacePaths, bookId);
  return getChapter(workspacePaths, bookId, id);
}

export async function getChapter(workspacePaths: WorkspacePaths, bookId: string, chapterId: string) {
  const chapters = await readChapters(workspacePaths, bookId);
  const chapter = chapters.find((item) => item.id === chapterId);

  if (!chapter) {
    throw notFound("章节不存在", { bookId, chapterId });
  }

  const content = await readTextFile(chapterPath(workspacePaths, bookId, chapter));
  return {
    ...chapter,
    content
  };
}

export async function updateChapter(workspacePaths: WorkspacePaths, bookId: string, chapterId: string, body: unknown) {
  const input = chapterUpdateInputSchema.parse(body);
  const chapters = await readChapters(workspacePaths, bookId);
  const chapter = chapters.find((item) => item.id === chapterId);

  if (!chapter) {
    throw notFound("章节不存在", { bookId, chapterId });
  }

  const currentContent = await readTextFile(chapterPath(workspacePaths, bookId, chapter));
  const nextContent = input.content ?? currentContent;
  const nextChapter: ChapterRecord = {
    ...chapter,
    title: input.title ?? chapter.title,
    outline: input.outline ?? chapter.outline,
    summary: input.summary ?? chapter.summary,
    status: input.status ?? chapter.status,
    wordCount: countWords(nextContent),
    updatedAt: new Date().toISOString()
  };

  await writeTextFileAtomic(chapterPath(workspacePaths, bookId, chapter), nextContent);
  await writeChapters(
    workspacePaths,
    bookId,
    chapters.map((item) => (item.id === chapterId ? nextChapter : item))
  );
  await updateBookProgress(workspacePaths, bookId);
  return getChapter(workspacePaths, bookId, chapterId);
}

export async function continueChapter(workspacePaths: WorkspacePaths, bookId: string, chapterId: string, body: unknown) {
  const input = chapterAiTaskInputSchema.parse(body);
  const chapter = await getChapter(workspacePaths, bookId, chapterId);
  const run = createRunRecord({
    bookId,
    runType: "continue_writing",
    inputJson: { chapterId, ...input }
  });
  const draft = `${chapter.content.trim()}\n\n${input.instruction || "继续推进当前章节。"}\n\n夜色在场景边缘慢慢压低，人物没有急着解释真相，只先做出一个能推动下一幕的小动作。`;
  return completeRun(workspacePaths, run, {
    chapterId,
    draft,
    note: "当前为确定性草稿，后续接入真实写作模型。"
  });
}

async function updateBookProgress(workspacePaths: WorkspacePaths, bookId: string) {
  const book = await getBook(workspacePaths, bookId);
  const chapters = await readChapters(workspacePaths, bookId);
  const writtenWords = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  const nextBook = {
    ...book,
    writtenWords,
    writtenChapters: chapters.length,
    currentChapterId: chapters.at(-1)?.id ?? book.currentChapterId,
    updatedAt: new Date().toISOString()
  };
  await saveBook(workspacePaths, nextBook);
}

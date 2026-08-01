import { bookDraftInputSchema, bookRecordSchema } from "../../schemas/bookSchemas.js";
import type { BookFileRecord, BookRecord } from "../../types/domain.js";
import { badRequest } from "../../utils/errors.js";
import { readJsonFile } from "../../utils/jsonStore.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { createBookPaths } from "./bookPaths.js";
import {
  createBookId,
  createBookStorage,
  deleteBookStorage,
  getBook,
  getBookFiles,
  listBooks,
  saveBook
} from "./bookRepository.js";
import { getWritingStyle } from "../styles/writingStyleService.js";
import { getStyleVersion } from "../styles/writingStyleVersionService.js";

function isBlank(value: unknown) {
  return value === null || value === undefined || value === "";
}

const aiFillIgnoredFields = new Set(["worldFileContent"]);

function collectNeedsAiFill(input: Record<string, unknown>) {
  return Object.entries(input)
    .filter(([key, value]) => !aiFillIgnoredFields.has(key) && isBlank(value))
    .map(([key]) => key);
}

function toBookListItem(book: BookRecord) {
  return {
    id: book.id,
    title: book.title,
    genre: book.genre,
    status: book.status,
    chapterCount: book.writtenChapters,
    updatedAt: book.updatedAt,
    progress: {
      writtenWords: book.writtenWords,
      writtenChapters: book.writtenChapters,
      plannedChapters:
        book.plannedWords && book.chapterWords ? Math.ceil(book.plannedWords / book.chapterWords) : null
    }
  };
}

function toBookDetailDto(book: BookRecord, files: BookFileRecord[]) {
  const worldFile = files.find((file) => file.fileType === "world") ?? null;
  const coreFiles = files.filter((file) =>
    ["brief", "outline", "current_state", "foreshadowing"].includes(file.fileType)
  );

  return {
    ...book,
    attributes: {
      narrationPerspective: book.narrationPerspective,
      channel: book.channel,
      protagonistGender: book.protagonistGender,
      protagonistName: book.protagonistName,
      plannedWords: book.plannedWords,
      chapterWords: book.chapterWords,
      writingStyleId: book.writingStyleId,
      writingStyleVersionId: book.writingStyleVersionId,
      worldFileId: book.worldFileId
    },
    progress: {
      writtenWords: book.writtenWords,
      writtenChapters: book.writtenChapters,
      plannedChapters:
        book.plannedWords && book.chapterWords ? Math.ceil(book.plannedWords / book.chapterWords) : null,
      currentChapterId: book.currentChapterId
    },
    files,
    coreFiles,
    worldview: worldFile,
    characters: []
  };
}

export async function listBookSummaries(workspacePaths: WorkspacePaths) {
  const books = await listBooks(workspacePaths);
  return books.map(toBookListItem);
}

export async function getBookDetail(workspacePaths: WorkspacePaths, bookId: string) {
  const book = await getBook(workspacePaths, bookId);
  const files = await getBookFiles(workspacePaths, bookId);
  return toBookDetailDto(book, files);
}

export async function createBook(workspacePaths: WorkspacePaths, body: unknown) {
  const input = bookDraftInputSchema.parse(body);
  const selectedStyle = input.writingStyleId ? await getWritingStyle(workspacePaths, input.writingStyleId) : null;
  const selectedVersionId = input.writingStyleVersionId ?? selectedStyle?.latestVersionId ?? null;
  if (selectedVersionId && selectedStyle) await getStyleVersion(workspacePaths, selectedStyle.id, selectedVersionId);
  const now = new Date().toISOString();
  const book: BookRecord = {
    id: createBookId(),
    title: input.title || "未命名作品",
    genre: input.genre || "待定题材",
    status: "planning",
    narrationPerspective: input.narrationPerspective,
    channel: input.channel,
    writingStyleId: input.writingStyleId,
    writingStyleVersionId: selectedVersionId,
    protagonistGender: input.protagonistGender,
    protagonistName: input.protagonistName,
    plannedWords: input.plannedWords,
    chapterWords: input.chapterWords,
    writtenWords: 0,
    writtenChapters: 0,
    currentChapterId: null,
    worldFileId: "world",
    needsAiFill: collectNeedsAiFill(input),
    createdAt: now,
    updatedAt: now
  };

  await createBookStorage(workspacePaths, book, {
    brief: input.brief,
    worldFileName: input.worldFileName,
    worldFileContent: input.worldFileContent
  });

  return getBookDetail(workspacePaths, book.id);
}

export async function updateBook(workspacePaths: WorkspacePaths, bookId: string, body: unknown) {
  const current = await getBook(workspacePaths, bookId);
  const patch = typeof body === "object" && body !== null ? body : {};
  const parsed = bookRecordSchema.partial().parse(patch);

  if (parsed.id && parsed.id !== bookId) {
    throw badRequest("不允许修改作品 ID", { bookId, nextId: parsed.id });
  }

  const nextBook: BookRecord = {
    ...current,
    ...parsed,
    id: bookId,
    updatedAt: new Date().toISOString()
  };

  if (parsed.writingStyleId !== undefined && parsed.writingStyleId !== current.writingStyleId) {
    if (parsed.writingStyleId) {
      const style = await getWritingStyle(workspacePaths, parsed.writingStyleId);
      nextBook.writingStyleVersionId = style.latestVersionId ?? null;
    } else {
      nextBook.writingStyleVersionId = null;
    }
  }
  if (parsed.writingStyleVersionId) {
    if (!nextBook.writingStyleId) throw badRequest("不能在未选择写作风格时设置风格版本");
    await getStyleVersion(workspacePaths, nextBook.writingStyleId, parsed.writingStyleVersionId);
  }

  await saveBook(workspacePaths, nextBook);
  return getBookDetail(workspacePaths, bookId);
}

export async function deleteBook(workspacePaths: WorkspacePaths, bookId: string) {
  await deleteBookStorage(workspacePaths, bookId);
  return {
    id: bookId,
    removedFiles: true
  };
}

export async function upgradeBookWritingStyleVersion(
  workspacePaths: WorkspacePaths,
  bookId: string,
  versionId?: string | null
) {
  const book = await getBook(workspacePaths, bookId);
  if (!book.writingStyleId) throw badRequest("作品尚未选择写作风格", { bookId });
  const style = await getWritingStyle(workspacePaths, book.writingStyleId);
  const nextVersionId = versionId ?? style.latestVersionId;
  if (!nextVersionId) throw badRequest("写作风格尚无可用版本", { writingStyleId: style.id });
  await getStyleVersion(workspacePaths, style.id, nextVersionId);
  const nextBook = { ...book, writingStyleVersionId: nextVersionId, updatedAt: new Date().toISOString() };
  await saveBook(workspacePaths, nextBook);
  return getBookDetail(workspacePaths, bookId);
}

export async function readBookRecordForDebug(workspacePaths: WorkspacePaths, bookId: string) {
  const paths = createBookPaths(workspacePaths, bookId);
  return readJsonFile(paths.bookFile, bookRecordSchema, {} as BookRecord);
}

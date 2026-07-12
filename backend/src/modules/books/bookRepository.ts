import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { booksIndexSchema, bookRecordSchema } from "../../schemas/bookSchemas.js";
import { bookFilesIndexSchema } from "../../schemas/fileSchemas.js";
import type { BookFileRecord, BookRecord } from "../../types/domain.js";
import { ensureDirectory, pathExists, readTextFile, writeTextFileAtomic } from "../../utils/fileStore.js";
import { notFound } from "../../utils/errors.js";
import { readJsonFile, writeJsonFile } from "../../utils/jsonStore.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { createBookPaths } from "./bookPaths.js";
import {
  createBriefMarkdown,
  createCurrentStateMarkdown,
  createForeshadowingMarkdown,
  createOutlineMarkdown,
  createWorldMarkdown
} from "./bookTemplates.js";

const emptyEntitiesSchema = booksIndexSchema.transform(() => []);
const emptyChaptersSchema = booksIndexSchema.transform(() => []);

export async function listBooks(workspacePaths: WorkspacePaths) {
  return readJsonFile(workspacePaths.booksIndexFile, booksIndexSchema, []);
}

async function writeBooksIndex(workspacePaths: WorkspacePaths, books: BookRecord[]) {
  await writeJsonFile(workspacePaths.booksIndexFile, books);
}

export async function getBook(workspacePaths: WorkspacePaths, bookId: string) {
  const paths = createBookPaths(workspacePaths, bookId);

  if (!(await pathExists(paths.bookFile))) {
    throw notFound("作品不存在", { bookId });
  }

  return readJsonFile(paths.bookFile, bookRecordSchema, {} as BookRecord);
}

export async function getBookFiles(workspacePaths: WorkspacePaths, bookId: string) {
  const paths = createBookPaths(workspacePaths, bookId);
  const files = await readJsonFile(paths.filesIndexFile, bookFilesIndexSchema, []);
  return files.map((file) => ({
    ...file,
    parsedJson: file.parsedJson ?? null
  })) as BookFileRecord[];
}

export async function saveBook(workspacePaths: WorkspacePaths, book: BookRecord) {
  const books = await listBooks(workspacePaths);
  const nextBooks = books.some((item) => item.id === book.id)
    ? books.map((item) => (item.id === book.id ? book : item))
    : [book, ...books];

  await writeBooksIndex(workspacePaths, nextBooks);
  await writeJsonFile(createBookPaths(workspacePaths, book.id).bookFile, book);
  return book;
}

function createCoreFiles(book: BookRecord, now: string): BookFileRecord[] {
  return [
    {
      id: "brief",
      bookId: book.id,
      fileType: "brief",
      title: "故事基石",
      path: "brief.md",
      summary: "作品核心卖点、读者承诺和创作边界。",
      contentHash: null,
      parsedJson: null,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "outline",
      bookId: book.id,
      fileType: "outline",
      title: "卷纲规划",
      path: "outline.md",
      summary: "章节推进、节奏和伏笔回收计划。",
      contentHash: null,
      parsedJson: null,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "world",
      bookId: book.id,
      fileType: "world",
      title: "世界观",
      path: "world.md",
      summary: "世界规则、地点和限制条件。",
      contentHash: null,
      parsedJson: null,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "current-state",
      bookId: book.id,
      fileType: "current_state",
      title: "当前状态",
      path: "state/current.md",
      summary: "已公开信息、未公开伏笔和下一章目标。",
      contentHash: null,
      parsedJson: null,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "foreshadowing",
      bookId: book.id,
      fileType: "foreshadowing",
      title: "伏笔池",
      path: "state/foreshadowing.md",
      summary: "伏笔投放、回收计划和状态。",
      contentHash: null,
      parsedJson: null,
      createdAt: now,
      updatedAt: now
    }
  ];
}

/**
 * 创建作品目录和默认文件。
 * 这里一次性创建 JSON 索引和 Markdown 占位文件，保证前端进入详情页时有稳定数据可读。
 */
export async function createBookStorage(
  workspacePaths: WorkspacePaths,
  book: BookRecord,
  options: { brief?: string; worldFileName?: string; worldFileContent?: string } = {}
) {
  const paths = createBookPaths(workspacePaths, book.id);
  const now = new Date().toISOString();

  await Promise.all([
    ensureDirectory(paths.bookDir),
    ensureDirectory(paths.chaptersDir),
    ensureDirectory(paths.charactersDir),
    ensureDirectory(paths.factionsDir),
    ensureDirectory(paths.locationsDir),
    ensureDirectory(paths.itemsDir),
    ensureDirectory(paths.runsDir),
    ensureDirectory(paths.importsDir)
  ]);

  const files = createCoreFiles(book, now);

  await Promise.all([
    writeJsonFile(paths.bookFile, book),
    writeJsonFile(paths.filesIndexFile, files),
    writeJsonFile(paths.entitiesIndexFile, []),
    writeJsonFile(paths.chaptersIndexFile, []),
    writeTextFileAtomic(paths.briefFile, createBriefMarkdown(book, options.brief)),
    writeTextFileAtomic(paths.outlineFile, createOutlineMarkdown()),
    writeTextFileAtomic(paths.worldFile, createWorldMarkdown(options.worldFileName, options.worldFileContent)),
    writeTextFileAtomic(paths.currentStateFile, createCurrentStateMarkdown()),
    writeTextFileAtomic(paths.foreshadowingFile, createForeshadowingMarkdown())
  ]);

  await saveBook(workspacePaths, book);

  return {
    book,
    files
  };
}

export async function deleteBookStorage(workspacePaths: WorkspacePaths, bookId: string) {
  const books = await listBooks(workspacePaths);
  const nextBooks = books.filter((book) => book.id !== bookId);

  if (books.length === nextBooks.length) {
    throw notFound("作品不存在", { bookId });
  }

  const bookDir = createBookPaths(workspacePaths, bookId).bookDir;
  await rm(bookDir, { recursive: true, force: true });

  if (await pathExists(workspacePaths.runsLogFile)) {
    const retainedRuns = (await readTextFile(workspacePaths.runsLogFile))
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => {
        try {
          return (JSON.parse(line) as { bookId?: string | null }).bookId !== bookId;
        } catch {
          return true;
        }
      });
    await writeTextFileAtomic(workspacePaths.runsLogFile, retainedRuns.length ? `${retainedRuns.join("\n")}\n` : "");
  }

  await writeBooksIndex(workspacePaths, nextBooks);
}

export function createBookId() {
  return randomUUID();
}

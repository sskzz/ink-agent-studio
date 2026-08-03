/**
 * 文件职责：作品（book）业务服务：创建/更新/删除/查询，含输入校验、写作风格关联与进度汇总。
 * 边界：只编排业务逻辑与校验，文件持久化委托给 bookRepository，风格校验委托给 styles 模块。
 */
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

/** 空值判定：null / undefined / 空字符串均视为未填写。 */
function isBlank(value: unknown) {
  return value === null || value === undefined || value === "";
}

/** AI 自动补全时忽略的字段（世界观文件内容不应被 AI 改写，只保留文件名）。 */
const aiFillIgnoredFields = new Set(["worldFileContent"]);

/** 收集需要 AI 补全的必填字段名（值为空且不在忽略列表中的字段）。 */
function collectNeedsAiFill(input: Record<string, unknown>) {
  return Object.entries(input)
    .filter(([key, value]) => !aiFillIgnoredFields.has(key) && isBlank(value))
    .map(([key]) => key);
}

/** 作品列表项 DTO：只暴露列表页需要的字段与进度估算（计划章数 = 计划字数 / 每章字数）。 */
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

/** 作品详情 DTO：聚合属性、进度、附属文件，并拆出核心文件与世界观文件。 */
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

/** 作品列表（摘要视图）。 */
export async function listBookSummaries(workspacePaths: WorkspacePaths) {
  const books = await listBooks(workspacePaths);
  return books.map(toBookListItem);
}

/** 作品详情：元数据 + 附属文件 + 聚合视图。 */
export async function getBookDetail(workspacePaths: WorkspacePaths, bookId: string) {
  const book = await getBook(workspacePaths, bookId);
  const files = await getBookFiles(workspacePaths, bookId);
  return toBookDetailDto(book, files);
}

/**
 * 创建作品：校验输入、解析写作风格与版本、生成初始记录并创建本地存储。
 * 缺失的必填字段记录到 needsAiFill，由后续 AI 初始化流程补全。
 */
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

/**
 * 更新作品：只允许修改 ID 之外的字段；更换写作风格时同步重置为最新版本，
 * 显式指定风格版本时校验版本属于该风格。
 * @throws badRequest 尝试修改作品 ID、或设置版本但未选择风格
 */
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

/** 删除作品（含本地文件与运行日志中的记录）。 */
export async function deleteBook(workspacePaths: WorkspacePaths, bookId: string) {
  await deleteBookStorage(workspacePaths, bookId);
  return {
    id: bookId,
    removedFiles: true
  };
}

/**
 * 升级作品的写作风格版本：默认升到最新版，也可显式指定版本。
 * @throws badRequest 作品未选风格、风格无可用版本或指定版本不存在
 */
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

/** 调试用：直接读取 book.json 原始记录，不做 DTO 转换。 */
export async function readBookRecordForDebug(workspacePaths: WorkspacePaths, bookId: string) {
  const paths = createBookPaths(workspacePaths, bookId);
  return readJsonFile(paths.bookFile, bookRecordSchema, {} as BookRecord);
}

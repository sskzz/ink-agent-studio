import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  bookFilesIndexSchema,
  fileUpdateInputSchema,
  fileUploadInputSchema
} from "../../schemas/fileSchemas.js";
import type { BookFileRecord } from "../../types/domain.js";
import { badRequest, notFound } from "../../utils/errors.js";
import { readTextFile, writeTextFileAtomic } from "../../utils/fileStore.js";
import { sha256 } from "../../utils/hash.js";
import { readJsonFile, writeJsonFile } from "../../utils/jsonStore.js";
import { resolveInsideRoot } from "../../utils/safePath.js";
import { createBookPaths } from "../books/bookPaths.js";
import { getBook } from "../books/bookRepository.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { parseMarkdown } from "./markdownParser.js";

async function readFiles(workspacePaths: WorkspacePaths, bookId: string) {
  const bookPaths = createBookPaths(workspacePaths, bookId);
  return readJsonFile(bookPaths.filesIndexFile, bookFilesIndexSchema, []);
}

async function writeFiles(workspacePaths: WorkspacePaths, bookId: string, files: BookFileRecord[]) {
  await writeJsonFile(createBookPaths(workspacePaths, bookId).filesIndexFile, files);
}

function resolveBookFilePath(workspacePaths: WorkspacePaths, bookId: string, file: BookFileRecord) {
  return resolveInsideRoot(createBookPaths(workspacePaths, bookId).bookDir, file.path);
}

export interface BookFilesSnapshot {
  files: BookFileRecord[];
  contents: Array<{ fileId: string; content: string }>;
}

export async function listBookFiles(workspacePaths: WorkspacePaths, bookId: string) {
  await getBook(workspacePaths, bookId);
  return readFiles(workspacePaths, bookId);
}

export async function captureBookFilesSnapshot(
  workspacePaths: WorkspacePaths,
  bookId: string,
  fileIds: readonly string[]
): Promise<BookFilesSnapshot> {
  const files = await listBookFiles(workspacePaths, bookId) as BookFileRecord[];
  const contents = await Promise.all(fileIds.map(async (fileId) => {
    const file = files.find((item) => item.id === fileId);
    if (!file) throw notFound("文件不存在", { bookId, fileId });
    return { fileId, content: await readTextFile(resolveBookFilePath(workspacePaths, bookId, file)) };
  }));
  return { files, contents };
}

export async function restoreBookFilesSnapshot(
  workspacePaths: WorkspacePaths,
  bookId: string,
  snapshot: BookFilesSnapshot
) {
  await Promise.all(snapshot.contents.map(async ({ fileId, content }) => {
    const file = snapshot.files.find((item) => item.id === fileId);
    if (!file) throw notFound("备份中的文件索引不存在", { bookId, fileId });
    await writeTextFileAtomic(resolveBookFilePath(workspacePaths, bookId, file), content);
  }));
  await writeFiles(workspacePaths, bookId, snapshot.files);
}

export async function getBookFileContent(workspacePaths: WorkspacePaths, bookId: string, fileId: string) {
  const files = await listBookFiles(workspacePaths, bookId);
  const file = files.find((item) => item.id === fileId);

  if (!file) {
    throw notFound("文件不存在", { bookId, fileId });
  }

  const content = await readTextFile(resolveBookFilePath(workspacePaths, bookId, file as BookFileRecord));
  return {
    ...file,
    content,
    parsedJson: parseMarkdown(content)
  };
}

export async function updateBookFileContent(workspacePaths: WorkspacePaths, bookId: string, fileId: string, body: unknown) {
  const input = fileUpdateInputSchema.parse(body);
  const files = await listBookFiles(workspacePaths, bookId);
  const file = files.find((item) => item.id === fileId) as BookFileRecord | undefined;

  if (!file) {
    throw notFound("文件不存在", { bookId, fileId });
  }

  const parsedJson = parseMarkdown(input.content);
  const updated: BookFileRecord = {
    ...file,
    contentHash: sha256(input.content),
    parsedJson,
    summary: parsedJson.summary || file.summary,
    updatedAt: new Date().toISOString()
  };

  await writeTextFileAtomic(resolveBookFilePath(workspacePaths, bookId, file), input.content);
  await writeFiles(
    workspacePaths,
    bookId,
    files.map((item) => (item.id === fileId ? updated : (item as BookFileRecord)))
  );

  return {
    ...updated,
    content: input.content
  };
}

export async function uploadBookFile(workspacePaths: WorkspacePaths, bookId: string, body: unknown) {
  const input = fileUploadInputSchema.parse(body);
  const bookPaths = createBookPaths(workspacePaths, bookId);
  const safeFileName = path.basename(input.fileName);

  if (!safeFileName.endsWith(".md") && !safeFileName.endsWith(".markdown")) {
    throw badRequest("只允许上传 Markdown 文件", { fileName: input.fileName });
  }

  const now = new Date().toISOString();
  const file: BookFileRecord = {
    id: randomUUID(),
    bookId,
    fileType: input.fileType,
    title: input.title,
    path: `imports/${safeFileName}`,
    summary: input.summary,
    contentHash: sha256(input.content),
    parsedJson: parseMarkdown(input.content),
    createdAt: now,
    updatedAt: now
  };

  const files = await listBookFiles(workspacePaths, bookId);
  await writeTextFileAtomic(resolveInsideRoot(bookPaths.importsDir, safeFileName), input.content);
  await writeFiles(workspacePaths, bookId, [file, ...files] as BookFileRecord[]);

  return {
    ...file,
    content: input.content
  };
}

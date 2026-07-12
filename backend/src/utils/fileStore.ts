import { mkdir, readFile, rename, stat, unlink, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

export async function pathExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDirectory(dirPath: string) {
  await mkdir(dirPath, { recursive: true });
}

export async function readTextFile(filePath: string) {
  return readFile(filePath, "utf8");
}

/**
 * 原子写入文本文件。
 * 先写临时文件再 rename，避免进程中断时把 JSON 或 Markdown 文件写成半截内容。
 */
export async function writeTextFileAtomic(filePath: string, content: string) {
  await ensureDirectory(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    if (await pathExists(tempPath)) {
      await unlink(tempPath);
    }

    throw error;
  }
}

/**
 * 追加 JSONL 日志。
 * Agent run 记录采用追加写，便于崩溃恢复和问题追踪。
 */
export async function appendLine(filePath: string, line: string) {
  await ensureDirectory(path.dirname(filePath));
  await appendFile(filePath, `${line}\n`, "utf8");
}

import { mkdir, readFile, rename, stat, unlink, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

/**
 * 文件系统基础操作集合。
 * 统一收敛 stat/读写/追加/原子替换的细节，业务代码只面对 promise 接口。
 */

/**
 * 判断路径是否存在（不区分文件或目录）。
 */
export async function pathExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 递归创建目录；目录已存在时静默成功。
 */
export async function ensureDirectory(dirPath: string) {
  await mkdir(dirPath, { recursive: true });
}

/**
 * 以 utf8 读取文本文件内容。
 */
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

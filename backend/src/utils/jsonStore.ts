import type { z } from "zod";
import { pathExists, readTextFile, writeTextFileAtomic } from "./fileStore.js";

/**
 * JSON 文件读写与校验。
 * 文件不存在或为空时自动写入 fallback，保证后端第一版以本地 JSON 为事实源时可以安全启动。
 */

/**
 * 读取 JSON 文件并用 Zod 校验。
 * 本地 JSON 是后端第一版事实源，必须在入口处校验，避免手动编辑后导致服务异常。
 */
export async function readJsonFile<TSchema extends z.ZodTypeAny>(
  filePath: string,
  schema: TSchema,
  fallback: z.output<TSchema>
): Promise<z.output<TSchema>> {
  if (!(await pathExists(filePath))) {
    await writeJsonFile(filePath, fallback);
    return fallback;
  }

  const raw = await readTextFile(filePath);

  if (!raw.trim()) {
    await writeJsonFile(filePath, fallback);
    return fallback;
  }

  const parsed = JSON.parse(raw) as unknown;
  return schema.parse(parsed);
}

/**
 * 格式化缩进写入 JSON 文件（原子替换），便于用户手工阅读和编辑。
 */
export async function writeJsonFile<T>(filePath: string, data: T) {
  await writeTextFileAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

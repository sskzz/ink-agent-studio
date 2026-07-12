import type { z } from "zod";
import { pathExists, readTextFile, writeTextFileAtomic } from "./fileStore.js";

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

export async function writeJsonFile<T>(filePath: string, data: T) {
  await writeTextFileAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

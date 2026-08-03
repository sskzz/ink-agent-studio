/**
 * 文件职责：作品事实卡片（facts.json）的读写仓库。
 * 边界：只做 JSON 文件的持久化，事实卡片的业务语义由使用方（连续性检查等）解释。
 */
import path from "node:path";
import { factCardListSchema, type FactCard } from "../../schemas/factSchemas.js";
import { readJsonFile, writeJsonFile } from "../../utils/jsonStore.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";

/** 事实卡片文件路径：{booksDir}/{bookId}/facts.json。 */
export function factCardsFilePath(paths: WorkspacePaths, bookId: string) {
  return path.join(paths.booksDir, bookId, "facts.json");
}

/** 读取事实卡片列表，文件缺失时返回空数组。 */
export async function readFactCards(paths: WorkspacePaths, bookId: string): Promise<FactCard[]> {
  return readJsonFile(factCardsFilePath(paths, bookId), factCardListSchema, []);
}

/** 整体写入事实卡片列表。 */
export async function writeFactCards(paths: WorkspacePaths, bookId: string, cards: FactCard[]): Promise<void> {
  await writeJsonFile(factCardsFilePath(paths, bookId), cards);
}

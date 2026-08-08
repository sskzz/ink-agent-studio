/**
 * runtime.json 迁移脚本：为旧管线初始化过的作品重建权威运行时状态。
 *
 * 背景：新架构下 state/runtime.json 是结构化权威状态（伏笔状态机、各章 delta 重放合成），
 * current.md / foreshadowing.md 降级为投影。旧书没有 runtime.json，
 * 本脚本从运行产物（runtime.sqlite 的 bundle artifact）重建 baseline 并落盘。
 *
 * 用法：pnpm --dir backend exec tsx scripts/rebuildRuntimeState.ts [bookId]
 * 未传 bookId 时默认使用《她们的外挂，我的日常》实验书。
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { createWorkspacePaths } from "../src/modules/workspace/workspacePaths.js";
import { createBaselineRuntimeState, writeRuntimeState } from "../src/modules/books/runtimeStateRepository.js";

/** 默认迁移对象：实验作品《她们的外挂，我的日常》。 */
const DEFAULT_BOOK_ID = "4f9711cb-0076-4018-b550-0f72165220c2";

async function main() {
  const bookId = process.argv[2] ?? DEFAULT_BOOK_ID;
  const paths = createWorkspacePaths();

  // 从运行产物中读取该作品最新的初始化 Bundle
  const database = new DatabaseSync(paths.runtimeDatabaseFile, { readOnly: true });
  const row = database
    .prepare(
      `SELECT a.inline_json
       FROM run_artifacts a
       JOIN runs r ON r.id = a.run_id
       WHERE r.book_id = ? AND a.artifact_type = 'book-initialization-bundle.v1'
       ORDER BY a.created_at DESC
       LIMIT 1`
    )
    .get(bookId);
  database.close();
  if (!row) {
    console.error(`未找到作品 ${bookId} 的初始化 Bundle 产物，无法重建运行时状态。`);
    process.exit(1);
  }
  const bundle = JSON.parse(String((row as { inline_json: string }).inline_json));

  // 用初始化 state 创建 baseline 并落盘（伏笔 lastAdvancedChapter 自动补 null）
  const runtimeState = createBaselineRuntimeState(bundle.state);
  await writeRuntimeState(paths, bookId, runtimeState);

  console.log(`作品 ${bookId} 运行时状态已重建：`);
  console.log(`- 伏笔 ${runtimeState.state.foreshadowing.length} 条、人物状态 ${runtimeState.state.characterStates.length} 条`);
  console.log(`- 文件：state/runtime.json（baseline 权威状态）`);
  console.log(`- 提示：如需同步更新 current.md / foreshadowing.md 投影，可重新运行初始化或等待下一次章节保存时由投影刷新。`);
}

void main().catch((error) => {
  console.error("运行时状态重建失败：", error);
  process.exit(1);
});

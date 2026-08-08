/**
 * facts.json 迁移脚本：为旧管线初始化过的作品重建事实卡。
 *
 * 背景：旧版初始化管线把骨架事件重建为 fact:backbone-key-N 编号 id，导致伏笔文本中的
 * ke- 与 st- 事件引用在持久化后悬空；且 supporting/items/state 的产出从不进入事实卡，
 * 跨阶段事实传播存在空洞。新版管线改用原始事件 id（fact:backbone-ke-3-2）并补齐
 * 实体卡/物品卡/状态卡。本脚本从运行产物（runtime.sqlite 的 bundle artifact）重建
 * facts.json，让旧作品立即获得新版事实卡结构，无需重新初始化。
 *
 * 用法：pnpm --dir backend exec tsx scripts/rebuildFacts.ts [bookId]
 * 未传 bookId 时默认使用《她们的外挂，我的日常》实验书。
 * 写盘前会把原 facts.json 备份为 facts.json.bak-{时间戳}。
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { createWorkspacePaths } from "../src/modules/workspace/workspacePaths.js";
import { getBook } from "../src/modules/books/bookRepository.js";
import { factCardsFilePath } from "../src/modules/books/factRepository.js";
import {
  buildSummaryFactCards,
  extractBackboneFacts,
  extractFoundationFacts,
  extractItemFacts,
  extractStateFacts,
  extractSupportingFacts,
  extractWorldFacts
} from "../src/modules/agents/initializationFacts.js";

/** 默认迁移对象：实验作品《她们的外挂，我的日常》。 */
const DEFAULT_BOOK_ID = "4f9711cb-0076-4018-b550-0f72165220c2";

async function main() {
  const bookId = process.argv[2] ?? DEFAULT_BOOK_ID;
  const paths = createWorkspacePaths();

  // 1. 从运行产物中读取该作品最新的初始化 Bundle
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
    console.error(`未找到作品 ${bookId} 的初始化 Bundle 产物，无法重建事实卡。`);
    process.exit(1);
  }
  const bundle = JSON.parse(String((row as { inline_json: string }).inline_json));

  // 2. 读取作品记录（extractFoundationFacts 需要锁定字段判断）
  const book = await getBook(paths, bookId);

  // 3. 用新版抽取函数重建事实卡：骨架保留原始事件 id，补齐实体/物品/状态卡
  const cards = [
    ...extractFoundationFacts(book, bundle.foundation),
    ...extractWorldFacts(bundle.world),
    ...extractBackboneFacts(bundle.backbone),
    ...extractSupportingFacts(bundle.supporting),
    ...extractItemFacts(bundle.items),
    ...extractStateFacts(bundle.state),
    ...buildSummaryFactCards(bundle)
  ];

  // 4. 备份旧 facts.json 后整体写回
  const target = factCardsFilePath(paths, bookId);
  if (fs.existsSync(target)) {
    const backup = `${target}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(target, backup);
    console.log(`已备份原事实卡：${backup}`);
  }
  fs.writeFileSync(target, JSON.stringify(cards, null, 2), "utf8");

  const byKind = new Map<string, number>();
  for (const card of cards) {
    byKind.set(card.kind, (byKind.get(card.kind) ?? 0) + 1);
  }
  console.log(`作品 ${bookId} 事实卡重建完成：共 ${cards.length} 张`);
  console.log(`分布：${[...byKind.entries()].map(([kind, count]) => `${kind}×${count}`).join("、")}`);
  console.log(`骨架事件卡示例：${cards.filter((card) => card.id.startsWith("fact:backbone-")).slice(0, 3).map((card) => card.id).join("、")}`);
}

void main().catch((error) => {
  console.error("事实卡重建失败：", error);
  process.exit(1);
});

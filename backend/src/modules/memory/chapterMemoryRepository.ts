/**
 * 章节记忆仓库（SQLite 时序记忆，借鉴 InkOS memory.db）。
 *
 * 职责：保存每章的状态观察结果（摘要 + 涉及的实体列表），续写时按实体交集检索
 * 相关章节摘要注入 prompt——替代"注入旧章节全文"，降低长书上下文膨胀。
 * 连接策略：与 Prompt 记忆一致，采用短生命周期连接（RuntimeDatabase 打开-使用-关闭），
 * 兼容不持有 ApplicationServices 的同步章节 API。
 */
import type { AppConfig } from "@ink-agent/contracts";
import { RuntimeDatabase } from "../../runtime/database/runtimeDatabase.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";

/** 章节记忆记录：摘要与实体列表（供检索）。 */
export interface ChapterMemoryRecord {
  chapterId: string;
  chapterNo: number;
  summary: string;
  entities: string[];
  createdAt: string;
}

/**
 * 章节记忆仓储操作（依赖已初始化的连接）。
 * 使用方式：withChapterMemory 打开短连接后调用。
 */
export class ChapterMemoryRepository {
  constructor(private readonly database: RuntimeDatabase) {}

  /** 写入/更新某章记忆（同一章节重复保存时覆盖）。 */
  upsert(record: ChapterMemoryRecord) {
    this.database.database
      .prepare(`
        INSERT INTO chapter_memory (chapter_id, chapter_no, summary, entities_json, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(chapter_id) DO UPDATE SET
          chapter_no = excluded.chapter_no,
          summary = excluded.summary,
          entities_json = excluded.entities_json,
          created_at = excluded.created_at
      `)
      .run(record.chapterId, record.chapterNo, record.summary, JSON.stringify(record.entities), record.createdAt);
  }

  /**
   * 检索与给定实体相关的章节记忆（按章节号倒序取最近 N 条）。
   * 实体交集匹配使用 JSON1 的 json_each；无交集时回退返回最近 limit 条（供全局摘要）。
   */
  findRelated(entities: string[], limit: number): ChapterMemoryRecord[] {
    if (entities.length === 0) {
      return this.listRecent(limit);
    }
    const placeholders = entities.map(() => "?").join(",");
    const rows = this.database.database
      .prepare(`
        SELECT m.chapter_id, m.chapter_no, m.summary, m.entities_json, m.created_at
        FROM chapter_memory m
        WHERE EXISTS (
          SELECT 1 FROM json_each(m.entities_json) AS entry
          WHERE entry.value IN (${placeholders})
        )
        ORDER BY m.chapter_no DESC
        LIMIT ?
      `)
      .all(...entities, limit);
    return rows.map(mapRow);
  }

  /** 取最近 N 条章节记忆（无实体命中时的全局回退）。 */
  listRecent(limit: number): ChapterMemoryRecord[] {
    const rows = this.database.database
      .prepare(`
        SELECT chapter_id, chapter_no, summary, entities_json, created_at
        FROM chapter_memory
        ORDER BY chapter_no DESC
        LIMIT ?
      `)
      .all(limit);
    return rows.map(mapRow);
  }

  /** 删除某章记忆（章节删除时调用）。 */
  remove(chapterId: string) {
    this.database.database
      .prepare("DELETE FROM chapter_memory WHERE chapter_id = ?")
      .run(chapterId);
  }
}

/** 数据库行 → 记忆记录。 */
function mapRow(row: unknown): ChapterMemoryRecord {
  const value = row as { chapter_id: string; chapter_no: number; summary: string; entities_json: string; created_at: string };
  return {
    chapterId: value.chapter_id,
    chapterNo: value.chapter_no,
    summary: value.summary,
    entities: JSON.parse(value.entities_json) as string[],
    createdAt: value.created_at
  };
}

/**
 * 以短生命周期连接执行章节记忆操作。
 * @param paths 工作区路径
 * @param config 应用配置（SQLite busy timeout 等）
 * @param operation 连接内执行的操作
 */
export async function withChapterMemory<T>(
  paths: WorkspacePaths,
  config: Pick<AppConfig, "storage">,
  operation: (repository: ChapterMemoryRepository) => Promise<T> | T
): Promise<T> {
  const runtimeDatabase = new RuntimeDatabase(paths);
  try {
    await runtimeDatabase.initialize({
      busyTimeoutMs: config.storage.sqliteBusyTimeoutMs,
      backupBeforeMigration: config.storage.backupBeforeMigration
    });
    return await operation(new ChapterMemoryRepository(runtimeDatabase));
  } finally {
    runtimeDatabase.close();
  }
}

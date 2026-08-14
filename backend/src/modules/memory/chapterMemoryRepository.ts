/**
 * 章节记忆仓库（SQLite 时序记忆，借鉴 InkOS memory.db）。
 *
 * 职责：保存每章的三层记忆（Raw → Synthesized → Summary）与实体索引，续写时以
 * FTS5/BM25、实体交集和时间衰减融合检索相关章节，而不是注入旧章节全文。
 * 连接策略：与 Prompt 记忆一致，采用短生命周期连接（RuntimeDatabase 打开-使用-关闭），
 * 兼容不持有 ApplicationServices 的同步章节 API。
 */
import type { AppConfig } from "@ink-agent/contracts";
import { RuntimeDatabase } from "../../runtime/database/runtimeDatabase.js";
import { sha256 } from "../../utils/hash.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { getLocalEmbeddingProvider, type TextEmbeddingProvider } from "./localEmbeddingService.js";

/** 章节记忆记录：摘要与实体列表（供检索）。 */
export interface ChapterMemoryRecord {
  bookId?: string;
  chapterId: string;
  chapterNo: number;
  chapterRevision?: number;
  contentHash?: string;
  summary: string;
  /** Raw：正文尾部证据片段，仅供本地检索/审计，不默认注入生成 Prompt。 */
  rawText?: string;
  /** Synthesized：由观察者归纳的可检索事件事实；优先于原始正文进入 Prompt。 */
  synthesizedText?: string;
  entities: string[];
  createdAt: string;
}

export interface ChapterMemorySearchInput {
  bookId: string;
  entities: string[];
  query: string;
  currentChapterNo: number;
  limit: number;
}

export interface ChapterMemorySearchResult extends ChapterMemoryRecord {
  score: number;
  matchReasons: Array<"entity" | "bm25" | "vector" | "recency">;
}

/**
 * 章节记忆仓储操作（依赖已初始化的连接）。
 * 使用方式：withChapterMemory 打开短连接后调用。
 */
export class ChapterMemoryRepository {
  constructor(
    private readonly database: RuntimeDatabase,
    private readonly embeddingProvider: TextEmbeddingProvider | null = null,
    private readonly vectorCandidateLimit = 1_000
  ) {}

  /** 写入/更新某章记忆（同一章节重复保存时覆盖）。 */
  upsert(record: ChapterMemoryRecord) {
    const sourceHash = embeddingSourceHash(record);
    this.database.database
      .prepare(`
        INSERT INTO chapter_memory (book_id, chapter_id, chapter_no, chapter_revision, content_hash, summary, raw_text, synthesized_text, entities_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(book_id, chapter_id) DO UPDATE SET
          chapter_no = excluded.chapter_no,
          chapter_revision = excluded.chapter_revision,
          content_hash = excluded.content_hash,
          summary = excluded.summary,
          raw_text = excluded.raw_text,
          synthesized_text = excluded.synthesized_text,
          entities_json = excluded.entities_json,
          created_at = excluded.created_at
      `)
      .run(
        record.bookId ?? "__legacy__",
        record.chapterId,
        record.chapterNo,
        record.chapterRevision ?? 1,
        record.contentHash ?? "legacy",
        record.summary,
        compact(record.rawText ?? "", 1_200),
        compact(record.synthesizedText ?? record.summary, 1_000),
        JSON.stringify(record.entities),
        record.createdAt
      );
    this.database.database.prepare(`
      DELETE FROM chapter_memory_embeddings
      WHERE book_id = ? AND chapter_id = ? AND source_hash <> ?
    `).run(record.bookId ?? "__legacy__", record.chapterId, sourceHash);
  }

  /** 写入章节记忆并尽力生成本地向量；向量运行时不可用不会阻断状态同步。 */
  async upsertWithEmbedding(record: ChapterMemoryRecord) {
    this.upsert(record);
    if (!this.embeddingProvider) return;
    const text = embeddingSourceText(record);
    const vectors = await this.embeddingProvider.embedDocuments([text]);
    const vector = vectors?.[0];
    if (!vector || vector.length !== this.embeddingProvider.dimensions) return;
    this.saveEmbedding(record.bookId ?? "__legacy__", record.chapterId, vector, sha256(text));
  }

  /**
   * 检索与给定实体相关的章节记忆（按章节号倒序取最近 N 条）。
   * 实体交集匹配使用 JSON1 的 json_each；无交集时回退返回最近 limit 条（供全局摘要）。
   */
  findRelated(bookId: string, entities: string[], limit: number): ChapterMemoryRecord[];
  findRelated(entities: string[], limit: number): ChapterMemoryRecord[];
  findRelated(bookOrEntities: string | string[], entitiesOrLimit: string[] | number, maybeLimit?: number): ChapterMemoryRecord[] {
    const bookId = Array.isArray(bookOrEntities) ? "__legacy__" : bookOrEntities;
    const entities = Array.isArray(bookOrEntities) ? bookOrEntities : entitiesOrLimit as string[];
    const limit = Array.isArray(bookOrEntities) ? entitiesOrLimit as number : maybeLimit as number;
    if (entities.length === 0) {
      return this.listRecent(bookId, limit);
    }
    const placeholders = entities.map(() => "?").join(",");
    const rows = this.database.database
      .prepare(`
        SELECT m.book_id, m.chapter_id, m.chapter_no, m.chapter_revision, m.content_hash, m.summary, m.raw_text, m.synthesized_text, m.entities_json, m.created_at
        FROM chapter_memory m
        WHERE m.book_id = ? AND EXISTS (
          SELECT 1 FROM json_each(m.entities_json) AS entry
          WHERE entry.value IN (${placeholders})
        )
        ORDER BY m.chapter_no DESC
        LIMIT ?
      `)
      .all(bookId, ...entities, limit);
    return rows.map(mapRow);
  }

  /** 取最近 N 条章节记忆（无实体命中时的全局回退）。 */
  listRecent(bookId: string, limit: number): ChapterMemoryRecord[];
  listRecent(limit: number): ChapterMemoryRecord[];
  listRecent(bookOrLimit: string | number, maybeLimit?: number): ChapterMemoryRecord[] {
    const bookId = typeof bookOrLimit === "number" ? "__legacy__" : bookOrLimit;
    const limit = typeof bookOrLimit === "number" ? bookOrLimit : maybeLimit as number;
    const rows = this.database.database
      .prepare(`
        SELECT book_id, chapter_id, chapter_no, chapter_revision, content_hash, summary, raw_text, synthesized_text, entities_json, created_at
        FROM chapter_memory
        WHERE book_id = ?
        ORDER BY chapter_no DESC
        LIMIT ?
      `)
      .all(bookId, limit);
    return rows.map(mapRow);
  }

  /**
   * 四路 RRF 融合检索：实体交集、FTS5/BM25、本地向量和时间序列各自独立排序后合并。
   * 本地模型或向量缺失时仅跳过 vector 路，不影响另外三路召回。
   */
  async search(input: ChapterMemorySearchInput): Promise<ChapterMemorySearchResult[]> {
    const candidates = new Map<string, ChapterMemorySearchResult>();
    const addRanked = (
      records: ChapterMemoryRecord[],
      reason: "entity" | "bm25" | "vector" | "recency",
      weight: number
    ) => {
      records.forEach((record, index) => {
      const current = candidates.get(record.chapterId) ?? { ...record, score: 0, matchReasons: [] };
        current.score += weight / (RRF_K + index + 1);
      if (!current.matchReasons.includes(reason)) current.matchReasons.push(reason);
      candidates.set(record.chapterId, current);
      });
    };
    const entityMatches = input.entities.length > 0 ? this.findRelated(input.bookId, input.entities, Math.max(input.limit * 4, 12)) : [];
    addRanked(entityMatches, "entity", 1.5);

    const query = buildFtsQuery(input.query);
    if (query) {
      const rows = this.database.database.prepare(`
        SELECT m.book_id, m.chapter_id, m.chapter_no, m.chapter_revision, m.content_hash, m.summary, m.raw_text, m.synthesized_text, m.entities_json, m.created_at,
          bm25(chapter_memory_fts) AS rank
        FROM chapter_memory_fts
        JOIN chapter_memory m ON m.rowid = chapter_memory_fts.rowid
        WHERE chapter_memory_fts MATCH ? AND m.book_id = ?
        ORDER BY rank
        LIMIT ?
      `).all(query, input.bookId, Math.max(input.limit * 4, 12));
      addRanked(rows.map(mapRow), "bm25", 1.25);
    }
    addRanked(await this.findVectorMatches(input), "vector", 1.4);
    const recent = this.listRecent(input.bookId, Math.max(input.limit * 2, 6))
      .filter((record) => record.chapterNo < input.currentChapterNo);
    addRanked(recent, "recency", 0.6);
    return [...candidates.values()]
      .sort((left, right) => right.score - left.score || right.chapterNo - left.chapterNo)
      .slice(0, input.limit);
  }

  private saveEmbedding(bookId: string, chapterId: string, vector: number[], sourceHash: string) {
    if (!this.embeddingProvider) return;
    const bytes = Buffer.from(new Float32Array(vector).buffer);
    this.database.database.prepare(`
      INSERT INTO chapter_memory_embeddings (
        book_id, chapter_id, model_id, dimensions, vector_blob, source_hash, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(book_id, chapter_id, model_id) DO UPDATE SET
        dimensions = excluded.dimensions,
        vector_blob = excluded.vector_blob,
        source_hash = excluded.source_hash,
        updated_at = excluded.updated_at
    `).run(
      bookId,
      chapterId,
      this.embeddingProvider.modelId,
      vector.length,
      bytes,
      sourceHash,
      new Date().toISOString()
    );
  }

  private async findVectorMatches(input: ChapterMemorySearchInput): Promise<ChapterMemoryRecord[]> {
    if (!this.embeddingProvider || !input.query.trim()) return [];
    const queryVector = await this.embeddingProvider.embedQuery(input.query);
    if (!queryVector || queryVector.length !== this.embeddingProvider.dimensions) return [];
    const rows = this.database.database.prepare(`
      SELECT m.book_id, m.chapter_id, m.chapter_no, m.chapter_revision, m.content_hash,
        m.summary, m.raw_text, m.synthesized_text, m.entities_json, m.created_at,
        e.dimensions, e.vector_blob
      FROM chapter_memory_embeddings e
      JOIN chapter_memory m ON m.book_id = e.book_id AND m.chapter_id = e.chapter_id
      WHERE e.book_id = ? AND e.model_id = ? AND m.chapter_no < ?
      ORDER BY m.chapter_no DESC
      LIMIT ?
    `).all(
      input.bookId,
      this.embeddingProvider.modelId,
      input.currentChapterNo,
      Math.max(this.vectorCandidateLimit, input.limit * 8)
    );
    return rows
      .map((row) => ({ record: mapRow(row), similarity: cosineSimilarity(queryVector, decodeVector(row)) }))
      .filter((item) => Number.isFinite(item.similarity) && item.similarity > 0)
      .sort((left, right) => right.similarity - left.similarity || right.record.chapterNo - left.record.chapterNo)
      .slice(0, Math.max(input.limit * 4, 12))
      .map((item) => item.record);
  }

  /** 删除某章记忆（章节删除时调用）。 */
  remove(bookId: string, chapterId: string): void;
  remove(chapterId: string): void;
  remove(bookOrChapterId: string, maybeChapterId?: string) {
    const bookId = maybeChapterId ? bookOrChapterId : "__legacy__";
    const chapterId = maybeChapterId ?? bookOrChapterId;
    this.database.database
      .prepare("DELETE FROM chapter_memory WHERE book_id = ? AND chapter_id = ?")
      .run(bookId, chapterId);
  }

  /** 旧章改写后，移除该章及之后全部派生记忆。 */
  removeFrom(bookId: string, chapterNo: number) {
    this.database.database
      .prepare("DELETE FROM chapter_memory WHERE book_id = ? AND chapter_no >= ?")
      .run(bookId, chapterNo);
  }
}

/** 数据库行 → 记忆记录。 */
function mapRow(row: unknown): ChapterMemoryRecord {
  const value = row as { book_id: string; chapter_id: string; chapter_no: number; chapter_revision: number; content_hash: string; summary: string; raw_text?: string; synthesized_text?: string; entities_json: string; created_at: string };
  return {
    bookId: value.book_id,
    chapterId: value.chapter_id,
    chapterNo: value.chapter_no,
    chapterRevision: value.chapter_revision,
    contentHash: value.content_hash,
    summary: value.summary,
    rawText: value.raw_text ?? "",
    synthesizedText: value.synthesized_text ?? value.summary,
    entities: JSON.parse(value.entities_json) as string[],
    createdAt: value.created_at
  };
}

function compact(value: string, max: number) {
  const characters = Array.from(value.trim());
  return characters.length <= max ? value.trim() : `${characters.slice(0, max - 1).join("")}…`;
}

function buildFtsQuery(query: string) {
  const tokens = query
    .split(/[\s，。！？、；：()（）【】《》]+/)
    .map((item) => item.trim())
    .filter((item) => Array.from(item).length >= 2)
    .slice(0, 8);
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
}

/**
 * 以短生命周期连接执行章节记忆操作。
 * @param paths 工作区路径
 * @param config 应用配置（SQLite busy timeout 等）
 * @param operation 连接内执行的操作
 */
export async function withChapterMemory<T>(
  paths: WorkspacePaths,
  config: Pick<AppConfig, "storage" | "memory">,
  operation: (repository: ChapterMemoryRepository) => Promise<T> | T
): Promise<T> {
  const runtimeDatabase = new RuntimeDatabase(paths);
  try {
    await runtimeDatabase.initialize({
      busyTimeoutMs: config.storage.sqliteBusyTimeoutMs,
      backupBeforeMigration: config.storage.backupBeforeMigration
    });
    return await operation(new ChapterMemoryRepository(
      runtimeDatabase,
      getLocalEmbeddingProvider(paths, config.memory.embedding),
      config.memory.embedding.candidateLimit
    ));
  } finally {
    runtimeDatabase.close();
  }
}

const RRF_K = 60;

function embeddingSourceText(record: ChapterMemoryRecord) {
  return [record.summary, record.synthesizedText ?? record.summary, record.entities.join("、")]
    .filter(Boolean)
    .join("\n");
}

function embeddingSourceHash(record: ChapterMemoryRecord) {
  return sha256(embeddingSourceText(record));
}

function decodeVector(row: unknown) {
  const value = row as { dimensions: number; vector_blob: Uint8Array };
  const bytes = value.vector_blob;
  const floats = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / Float32Array.BYTES_PER_ELEMENT));
  return Array.from(floats).slice(0, value.dimensions);
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || left.length !== right.length) return Number.NEGATIVE_INFINITY;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) return Number.NEGATIVE_INFINITY;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

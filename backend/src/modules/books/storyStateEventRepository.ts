import type { AppConfig } from "@ink-agent/contracts";
import { stateDeltaSchema, type RuntimeStateDeltaRecord, type StateDelta } from "../../schemas/runtimeStateSchemas.js";
import { RuntimeDatabase } from "../../runtime/database/runtimeDatabase.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";

export type ChapterStateSyncStatus = "pending" | "processing" | "synced" | "failed" | "stale";

export interface StoryStateEventInput {
  bookId: string;
  chapterId: string;
  chapterNo: number;
  chapterRevision: number;
  contentHash: string;
  delta: StateDelta;
  sourceRunId?: string | null;
  recordedAt?: string;
}

export interface PendingChapterObservation {
  bookId: string;
  chapterId: string;
  chapterNo: number;
  chapterRevision: number;
  contentHash: string;
  sourceRunId: string | null;
  status: Exclude<ChapterStateSyncStatus, "synced" | "failed">;
}

/** SQLite 中的章节状态事件与可靠观察任务仓库。 */
export class StoryStateEventRepository {
  constructor(private readonly database: RuntimeDatabase) {}

  listEvents(bookId: string): RuntimeStateDeltaRecord[] {
    return this.database.database.prepare(`
      SELECT chapter_id, chapter_no, chapter_revision, observation_revision, content_hash, delta_json, recorded_at
      FROM story_state_events
      WHERE book_id = ?
      ORDER BY chapter_no, chapter_id
    `).all(bookId).map((row) => {
      const value = row as Record<string, unknown>;
      return {
        chapterId: String(value.chapter_id),
        chapterNo: Number(value.chapter_no),
        chapterRevision: Number(value.chapter_revision),
        observationRevision: Number(value.observation_revision),
        contentHash: String(value.content_hash),
        recordedAt: String(value.recorded_at),
        delta: stateDeltaSchema.parse(JSON.parse(String(value.delta_json)))
      };
    });
  }

  listRecoverableObservations(): PendingChapterObservation[] {
    return this.database.database.prepare(`
      SELECT book_id, chapter_id, chapter_no, chapter_revision, content_hash, source_run_id, status
      FROM chapter_state_outbox
      WHERE status IN ('pending', 'processing', 'stale')
      ORDER BY book_id, chapter_no, chapter_id
    `).all().map((row) => {
      const value = row as Record<string, unknown>;
      return {
        bookId: String(value.book_id),
        chapterId: String(value.chapter_id),
        chapterNo: Number(value.chapter_no),
        chapterRevision: Number(value.chapter_revision),
        contentHash: String(value.content_hash),
        sourceRunId: value.source_run_id === null ? null : String(value.source_run_id),
        status: String(value.status) as PendingChapterObservation["status"]
      };
    });
  }

  resetRecoverableObservations() {
    this.database.database.prepare(`
      UPDATE chapter_state_outbox
      SET status = 'pending', observation_run_id = NULL, updated_at = ?
      WHERE status IN ('pending', 'processing', 'stale')
    `).run(new Date().toISOString());
  }

  nextPendingObservation(bookId: string): PendingChapterObservation | null {
    const row = this.database.database.prepare(`
      SELECT book_id, chapter_id, chapter_no, chapter_revision, content_hash, source_run_id, status
      FROM chapter_state_outbox
      WHERE book_id = ?
        AND status = 'pending'
        AND observation_run_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM chapter_state_outbox earlier
          WHERE earlier.book_id = chapter_state_outbox.book_id
            AND (earlier.chapter_no < chapter_state_outbox.chapter_no
              OR (earlier.chapter_no = chapter_state_outbox.chapter_no AND earlier.chapter_id < chapter_state_outbox.chapter_id))
            AND earlier.status <> 'synced'
        )
      ORDER BY chapter_no, chapter_id
      LIMIT 1
    `).get(bookId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      bookId: String(row.book_id),
      chapterId: String(row.chapter_id),
      chapterNo: Number(row.chapter_no),
      chapterRevision: Number(row.chapter_revision),
      contentHash: String(row.content_hash),
      sourceRunId: row.source_run_id === null ? null : String(row.source_run_id),
      status: String(row.status) as PendingChapterObservation["status"]
    };
  }

  replaceEvent(input: StoryStateEventInput) {
    const pending = this.database.database.prepare(`
      SELECT chapter_revision, content_hash
      FROM chapter_state_outbox
      WHERE book_id = ? AND chapter_id = ?
    `).get(input.bookId, input.chapterId) as { chapter_revision?: number; content_hash?: string } | undefined;
    if (pending && (Number(pending.chapter_revision) !== input.chapterRevision || String(pending.content_hash) !== input.contentHash)) {
      return false;
    }
    const recordedAt = input.recordedAt ?? new Date().toISOString();
    this.database.database.prepare(`
      INSERT INTO story_state_events (
        book_id, chapter_id, chapter_no, chapter_revision, observation_revision,
        content_hash, delta_json, source_run_id, recorded_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(book_id, chapter_id) DO UPDATE SET
        chapter_no = excluded.chapter_no,
        chapter_revision = excluded.chapter_revision,
        observation_revision = story_state_events.observation_revision + 1,
        content_hash = excluded.content_hash,
        delta_json = excluded.delta_json,
        source_run_id = excluded.source_run_id,
        recorded_at = excluded.recorded_at
    `).run(
      input.bookId,
      input.chapterId,
      input.chapterNo,
      input.chapterRevision,
      input.contentHash,
      JSON.stringify(stateDeltaSchema.parse(input.delta)),
      input.sourceRunId ?? null,
      recordedAt
    );
    return true;
  }

  removeEvent(bookId: string, chapterId: string) {
    this.database.database.prepare(
      "DELETE FROM story_state_events WHERE book_id = ? AND chapter_id = ?"
    ).run(bookId, chapterId);
    this.database.database.prepare(
      "DELETE FROM chapter_state_outbox WHERE book_id = ? AND chapter_id = ?"
    ).run(bookId, chapterId);
  }

  isCurrentObservation(
    bookId: string,
    chapterId: string,
    chapterRevision: number,
    contentHash: string,
    observationRunId: string
  ) {
    return Boolean(this.database.database.prepare(`
      SELECT 1
      FROM chapter_state_outbox
      WHERE book_id = ?
        AND chapter_id = ?
        AND chapter_revision = ?
        AND content_hash = ?
        AND observation_run_id = ?
        AND status IN ('pending', 'processing')
    `).get(bookId, chapterId, chapterRevision, contentHash, observationRunId));
  }

  invalidateFrom(bookId: string, chapterNo: number, exceptChapterId?: string) {
    if (exceptChapterId) {
      this.database.database.prepare(`
        DELETE FROM story_state_events
        WHERE book_id = ? AND chapter_no >= ? AND chapter_id <> ?
      `).run(bookId, chapterNo, exceptChapterId);
      return;
    }
    this.database.database.prepare(
      "DELETE FROM story_state_events WHERE book_id = ? AND chapter_no >= ?"
    ).run(bookId, chapterNo);
  }

  queueObservation(input: Omit<StoryStateEventInput, "delta" | "recordedAt"> & { observationRunId?: string | null }) {
    const now = new Date().toISOString();
    this.database.database.prepare(`
      INSERT INTO chapter_state_outbox (
        book_id, chapter_id, chapter_no, chapter_revision, content_hash,
        source_run_id, observation_run_id, status, attempt_count,
        error_message, created_at, updated_at, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?, NULL)
      ON CONFLICT(book_id, chapter_id) DO UPDATE SET
        chapter_no = excluded.chapter_no,
        chapter_revision = excluded.chapter_revision,
        content_hash = excluded.content_hash,
        source_run_id = excluded.source_run_id,
        observation_run_id = excluded.observation_run_id,
        status = 'pending',
        attempt_count = 0,
        error_message = NULL,
        updated_at = excluded.updated_at,
        synced_at = NULL
    `).run(
      input.bookId,
      input.chapterId,
      input.chapterNo,
      input.chapterRevision,
      input.contentHash,
      input.sourceRunId ?? null,
      input.observationRunId ?? null,
      now,
      now
    );
  }

  setObservationRun(bookId: string, chapterId: string, observationRunId: string) {
    this.database.database.prepare(`
      UPDATE chapter_state_outbox
      SET observation_run_id = ?, updated_at = ?
      WHERE book_id = ? AND chapter_id = ?
    `).run(observationRunId, new Date().toISOString(), bookId, chapterId);
  }

  markObservation(
    bookId: string,
    chapterId: string,
    status: ChapterStateSyncStatus,
    error?: string | null,
    expected?: { chapterRevision: number; contentHash: string; observationRunId?: string }
  ) {
    const now = new Date().toISOString();
    const expectedClause = expected
      ? ` AND chapter_revision = ? AND content_hash = ?${expected.observationRunId ? " AND observation_run_id = ?" : ""}`
      : "";
    const result = this.database.database.prepare(`
      UPDATE chapter_state_outbox
      SET status = ?,
          attempt_count = attempt_count + CASE WHEN ? = 'processing' THEN 1 ELSE 0 END,
          error_message = ?,
          updated_at = ?,
          synced_at = CASE WHEN ? = 'synced' THEN ? ELSE NULL END
      WHERE book_id = ? AND chapter_id = ?${expectedClause}
    `).run(
      status,
      status,
      error ?? null,
      now,
      status,
      now,
      bookId,
      chapterId,
      ...(expected
        ? [expected.chapterRevision, expected.contentHash, ...(expected.observationRunId ? [expected.observationRunId] : [])]
        : [])
    );
    return result.changes > 0;
  }

  markStaleFrom(bookId: string, chapterNo: number, exceptChapterId?: string) {
    const now = new Date().toISOString();
    if (exceptChapterId) {
      this.database.database.prepare(`
        UPDATE chapter_state_outbox
        SET status = 'stale', error_message = '前序章节发生改写，需要重新观察', updated_at = ?, synced_at = NULL
        WHERE book_id = ? AND chapter_no >= ? AND chapter_id <> ?
      `).run(now, bookId, chapterNo, exceptChapterId);
      return;
    }
    this.database.database.prepare(`
      UPDATE chapter_state_outbox
      SET status = 'stale', error_message = '前序章节发生改写，需要重新观察', updated_at = ?, synced_at = NULL
      WHERE book_id = ? AND chapter_no >= ?
    `).run(now, bookId, chapterNo);
  }
}

export async function withStoryStateEvents<T>(
  paths: WorkspacePaths,
  config: Pick<AppConfig, "storage">,
  operation: (repository: StoryStateEventRepository) => Promise<T> | T
): Promise<T> {
  const runtimeDatabase = new RuntimeDatabase(paths);
  try {
    await runtimeDatabase.initialize({
      busyTimeoutMs: config.storage.sqliteBusyTimeoutMs,
      backupBeforeMigration: config.storage.backupBeforeMigration
    });
    return await operation(new StoryStateEventRepository(runtimeDatabase));
  } finally {
    runtimeDatabase.close();
  }
}

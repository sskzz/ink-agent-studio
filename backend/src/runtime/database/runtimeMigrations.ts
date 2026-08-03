import type { DatabaseSync } from "node:sqlite";

/**
 * 运行数据库版本化迁移。
 * 迁移按 version 升序定义，每个迁移在独立事务中执行并登记到 schema_migrations；
 * 只允许向前升级，发现比程序支持的版本更新会直接报错拒绝启动。
 */

/** 单个迁移定义：version 必须单调递增，name 唯一，sql 在事务内执行。 */
export interface RuntimeMigration {
  version: number;
  name: string;
  sql: string;
}

/**
 * 全部迁移清单（v1-v8）。
 * 说明：runs/run_events/run_artifacts/run_checkpoints/model_attempts 为可重放的运行数据；
 * state_patches 为状态补丁日志；sessions/session_messages(含 FTS) 为会话与消息检索；
 * user_preferences 为偏好记忆，并配套生命周期触发器保证状态机不越界。
 */
export const runtimeMigrations: RuntimeMigration[] = [
  {
    version: 1,
    name: "create_run_event_store",
    sql: `
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        schema_version TEXT NOT NULL,
        command_type TEXT NOT NULL,
        command_json TEXT NOT NULL CHECK (json_valid(command_json)),
        book_id TEXT,
        chapter_id TEXT,
        parent_run_id TEXT,
        root_run_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN (
          'queued', 'running', 'cancelling', 'cancelled', 'completed', 'failed', 'interrupted'
        )),
        current_stage TEXT,
        config_revision INTEGER,
        config_hash TEXT,
        output_json TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
        error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
        cancel_requested_at TEXT,
        last_event_seq INTEGER NOT NULL DEFAULT -1 CHECK (last_event_seq >= -1),
        created_at TEXT NOT NULL,
        queued_at TEXT,
        started_at TEXT,
        finished_at TEXT,
        updated_at TEXT NOT NULL,
        origin TEXT NOT NULL DEFAULT 'native' CHECK (origin IN ('native', 'legacy_jsonl')),
        FOREIGN KEY (parent_run_id) REFERENCES runs(id) ON DELETE SET NULL
      ) STRICT;

      CREATE INDEX runs_status_created_idx ON runs(status, created_at DESC);
      CREATE INDEX runs_book_created_idx ON runs(book_id, created_at DESC);
      CREATE INDEX runs_root_idx ON runs(root_run_id, created_at);

      CREATE TABLE run_events (
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL CHECK (seq >= 0),
        event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        stage TEXT,
        timestamp TEXT NOT NULL,
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        artifact_refs_json TEXT NOT NULL CHECK (json_valid(artifact_refs_json)),
        PRIMARY KEY (run_id, seq),
        FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX run_events_timestamp_idx ON run_events(run_id, timestamp);

      CREATE TABLE run_artifacts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        artifact_type TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        storage_kind TEXT NOT NULL CHECK (storage_kind IN ('inline_json', 'file')),
        inline_json TEXT CHECK (inline_json IS NULL OR json_valid(inline_json)),
        file_path TEXT,
        content_hash TEXT NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
        created_at TEXT NOT NULL,
        CHECK (
          (storage_kind = 'inline_json' AND inline_json IS NOT NULL AND file_path IS NULL)
          OR (storage_kind = 'file' AND file_path IS NOT NULL AND inline_json IS NULL)
        ),
        FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX run_artifacts_run_idx ON run_artifacts(run_id, created_at);

      CREATE TABLE run_checkpoints (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        event_seq INTEGER NOT NULL CHECK (event_seq >= 0),
        stage TEXT NOT NULL,
        checkpoint_json TEXT NOT NULL CHECK (json_valid(checkpoint_json)),
        resumable INTEGER NOT NULL CHECK (resumable IN (0, 1)),
        created_at TEXT NOT NULL,
        UNIQUE (run_id, event_seq),
        FOREIGN KEY (run_id, event_seq) REFERENCES run_events(run_id, seq) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE model_attempts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        stage TEXT,
        purpose TEXT NOT NULL,
        model_config_id TEXT,
        provider TEXT,
        model TEXT,
        attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'timed_out')),
        request_hash TEXT,
        prompt_tokens INTEGER CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
        completion_tokens INTEGER CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
        total_tokens INTEGER CHECK (total_tokens IS NULL OR total_tokens >= 0),
        estimated_cost_micros INTEGER CHECK (estimated_cost_micros IS NULL OR estimated_cost_micros >= 0),
        latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
        error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX model_attempts_run_idx ON model_attempts(run_id, started_at);

      CREATE TABLE legacy_import_entries (
        source_path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        line_number INTEGER NOT NULL CHECK (line_number >= 1),
        legacy_run_id TEXT,
        import_status TEXT NOT NULL CHECK (import_status IN ('imported', 'skipped_native', 'invalid')),
        error_message TEXT,
        imported_at TEXT NOT NULL,
        PRIMARY KEY (source_path, content_hash)
      ) STRICT;
    `
  },
  {
    version: 2,
    name: "create_state_patch_journal",
    sql: `
      CREATE TABLE state_patches (
        id TEXT PRIMARY KEY,
        schema_version TEXT NOT NULL,
        run_id TEXT NOT NULL,
        book_id TEXT NOT NULL,
        target_kind TEXT NOT NULL CHECK (target_kind IN ('book_file', 'chapter')),
        target_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN (
          'proposed', 'applying', 'applied', 'rejected', 'conflicted', 'failed'
        )),
        reason TEXT NOT NULL,
        base_hash TEXT NOT NULL,
        proposed_hash TEXT NOT NULL,
        proposed_content TEXT NOT NULL,
        backup_file TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        applied_at TEXT,
        rejected_at TEXT,
        FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE RESTRICT
      ) STRICT;

      CREATE INDEX state_patches_run_idx ON state_patches(run_id, created_at DESC);
      CREATE INDEX state_patches_book_idx ON state_patches(book_id, created_at DESC);
      CREATE INDEX state_patches_status_idx ON state_patches(status, updated_at);
    `
  },
  {
    version: 3,
    name: "create_sessions_and_message_search",
    sql: `
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        schema_version TEXT NOT NULL,
        book_id TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
        parent_session_id TEXT,
        last_message_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (parent_session_id) REFERENCES sessions(id) ON DELETE SET NULL
      ) STRICT;

      CREATE INDEX sessions_book_updated_idx ON sessions(book_id, updated_at DESC);
      CREATE INDEX sessions_status_updated_idx ON sessions(status, updated_at DESC);

      CREATE TABLE session_messages (
        id TEXT PRIMARY KEY,
        schema_version TEXT NOT NULL,
        session_id TEXT NOT NULL,
        book_id TEXT,
        parent_message_id TEXT,
        role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        token_estimate INTEGER NOT NULL CHECK (token_estimate >= 0),
        metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_message_id) REFERENCES session_messages(id) ON DELETE SET NULL
      ) STRICT;

      CREATE INDEX session_messages_session_created_idx ON session_messages(session_id, created_at);
      CREATE INDEX session_messages_book_created_idx ON session_messages(book_id, created_at DESC);

      CREATE VIRTUAL TABLE session_messages_fts USING fts5(
        session_id UNINDEXED,
        book_id UNINDEXED,
        content,
        content = 'session_messages',
        content_rowid = 'rowid',
        tokenize = 'trigram'
      );

      CREATE TRIGGER session_messages_fts_insert AFTER INSERT ON session_messages BEGIN
        INSERT INTO session_messages_fts(rowid, session_id, book_id, content)
        VALUES (new.rowid, new.session_id, new.book_id, new.content);
      END;
      CREATE TRIGGER session_messages_fts_delete AFTER DELETE ON session_messages BEGIN
        INSERT INTO session_messages_fts(session_messages_fts, rowid, session_id, book_id, content)
        VALUES ('delete', old.rowid, old.session_id, old.book_id, old.content);
      END;
      CREATE TRIGGER session_messages_fts_update AFTER UPDATE ON session_messages BEGIN
        INSERT INTO session_messages_fts(session_messages_fts, rowid, session_id, book_id, content)
        VALUES ('delete', old.rowid, old.session_id, old.book_id, old.content);
        INSERT INTO session_messages_fts(rowid, session_id, book_id, content)
        VALUES (new.rowid, new.session_id, new.book_id, new.content);
      END;

      CREATE TABLE session_runs (
        session_id TEXT NOT NULL,
        run_id TEXT NOT NULL UNIQUE,
        trigger_message_id TEXT,
        response_message_id TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (session_id, run_id),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
        FOREIGN KEY (trigger_message_id) REFERENCES session_messages(id) ON DELETE SET NULL,
        FOREIGN KEY (response_message_id) REFERENCES session_messages(id) ON DELETE SET NULL
      ) STRICT;

      ALTER TABLE runs ADD COLUMN session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;
      ALTER TABLE runs ADD COLUMN trigger_message_id TEXT REFERENCES session_messages(id) ON DELETE SET NULL;
      CREATE INDEX runs_session_created_idx ON runs(session_id, created_at DESC);
    `
  },
  {
    version: 4,
    name: "add_model_attempt_cost_currency",
    sql: `
      ALTER TABLE model_attempts ADD COLUMN cost_currency TEXT
        CHECK (cost_currency IS NULL OR length(cost_currency) = 3);
    `
  },
  {
    version: 5,
    name: "create_user_preference_memory",
    sql: `
      CREATE TABLE user_preferences (
        id TEXT PRIMARY KEY,
        schema_version TEXT NOT NULL,
        category TEXT NOT NULL CHECK (category IN ('writing', 'review', 'workflow', 'formatting')),
        preference_key TEXT NOT NULL CHECK (preference_key IN (
          'narrative_pacing', 'paragraph_length', 'dialogue_density', 'description_density',
          'emotion_expression', 'banned_expressions', 'review_strictness', 'revision_scope',
          'output_format', 'interaction_style'
        )),
        value TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('proposed', 'active', 'rejected', 'archived')),
        priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 100),
        token_estimate INTEGER NOT NULL CHECK (token_estimate > 0),
        source_session_id TEXT,
        source_message_id TEXT,
        replaces_preference_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        approved_at TEXT,
        rejected_at TEXT,
        archived_at TEXT,
        FOREIGN KEY (source_session_id) REFERENCES sessions(id) ON DELETE SET NULL,
        FOREIGN KEY (source_message_id) REFERENCES session_messages(id) ON DELETE SET NULL,
        FOREIGN KEY (replaces_preference_id) REFERENCES user_preferences(id) ON DELETE SET NULL
      ) STRICT;

      CREATE UNIQUE INDEX user_preferences_active_key_idx
        ON user_preferences(preference_key) WHERE status = 'active';
      CREATE INDEX user_preferences_status_priority_idx
        ON user_preferences(status, priority DESC, updated_at DESC);
    `
  },
  {
    version: 6,
    name: "add_user_preference_rejection_reason",
    sql: `
      ALTER TABLE user_preferences ADD COLUMN rejection_reason TEXT;
    `
  },
  {
    version: 7,
    name: "enforce_user_preference_lifecycle",
    sql: `
      CREATE TRIGGER user_preferences_source_insert_guard
      BEFORE INSERT ON user_preferences
      WHEN NEW.source_message_id IS NOT NULL AND NEW.source_session_id IS NULL
      BEGIN
        SELECT RAISE(ABORT, 'source message requires source session');
      END;

      CREATE TRIGGER user_preferences_source_update_guard
      BEFORE UPDATE OF source_session_id, source_message_id ON user_preferences
      WHEN NEW.source_message_id IS NOT NULL AND NEW.source_session_id IS NULL
      BEGIN
        SELECT RAISE(ABORT, 'source message requires source session');
      END;

      CREATE TRIGGER user_preferences_source_membership_insert_guard
      BEFORE INSERT ON user_preferences
      WHEN NEW.source_message_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM session_messages
        WHERE id = NEW.source_message_id AND session_id = NEW.source_session_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'source message does not belong to source session');
      END;

      CREATE TRIGGER user_preferences_source_membership_update_guard
      BEFORE UPDATE OF source_session_id, source_message_id ON user_preferences
      WHEN NEW.source_message_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM session_messages
        WHERE id = NEW.source_message_id AND session_id = NEW.source_session_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'source message does not belong to source session');
      END;

      CREATE TRIGGER user_preferences_transition_guard
      BEFORE UPDATE OF status ON user_preferences
      WHEN OLD.status <> NEW.status AND NOT (
        (OLD.status = 'proposed' AND NEW.status IN ('active', 'rejected'))
        OR (OLD.status = 'active' AND NEW.status = 'archived')
      )
      BEGIN
        SELECT RAISE(ABORT, 'invalid user preference status transition');
      END;

      CREATE TRIGGER user_preferences_lifecycle_insert_guard
      BEFORE INSERT ON user_preferences
      WHEN NOT (
        NEW.status = 'proposed'
        AND NEW.approved_at IS NULL
        AND NEW.rejected_at IS NULL
        AND NEW.archived_at IS NULL
        AND NEW.rejection_reason IS NULL
      )
      BEGIN
        SELECT RAISE(ABORT, 'user preference must be inserted as proposed');
      END;

      CREATE TRIGGER user_preferences_lifecycle_update_guard
      BEFORE UPDATE ON user_preferences
      WHEN NOT (
        (NEW.status = 'proposed' AND NEW.approved_at IS NULL AND NEW.rejected_at IS NULL AND NEW.archived_at IS NULL AND NEW.rejection_reason IS NULL)
        OR (NEW.status = 'active' AND NEW.approved_at IS NOT NULL AND NEW.rejected_at IS NULL AND NEW.archived_at IS NULL AND NEW.rejection_reason IS NULL)
        OR (NEW.status = 'rejected' AND NEW.approved_at IS NULL AND NEW.rejected_at IS NOT NULL AND NEW.archived_at IS NULL AND NEW.rejection_reason IS NOT NULL)
        OR (NEW.status = 'archived' AND NEW.approved_at IS NOT NULL AND NEW.rejected_at IS NULL AND NEW.archived_at IS NOT NULL AND NEW.rejection_reason IS NULL)
      )
      BEGIN
        SELECT RAISE(ABORT, 'invalid user preference lifecycle metadata');
      END;
    `
  },
  {
    version: 8,
    name: "make_approved_user_preferences_immutable",
    sql: `
      CREATE TRIGGER user_preferences_approved_content_immutable
      BEFORE UPDATE OF category, preference_key, value, reason, priority, token_estimate ON user_preferences
      WHEN OLD.status <> 'proposed'
      BEGIN
        SELECT RAISE(ABORT, 'approved user preference content is immutable');
      END;
    `
  }
];

/**
 * 读取已登记的迁移版本列表。
 * schema_migrations 表不存在时视为全新库，返回空数组。
 */
export function readAppliedMigrationVersions(database: DatabaseSync) {
  const table = database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
  ).get();
  if (!table) return [];

  return database.prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all()
    .map((row) => Number(row.version));
}

/**
 * 应用所有未执行的迁移。
 * 先检查库版本不高于程序支持版本（防止旧程序降级打开新库），
 * 然后逐个迁移：每个迁移一个事务，SQL 失败自动回滚该版本，已登记版本跳过。
 * 返回本次新应用的迁移列表。
 */
export function applyRuntimeMigrations(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const applied = new Set(readAppliedMigrationVersions(database));
  const latestVersion = runtimeMigrations.at(-1)?.version ?? 0;
  // 数据库版本超前说明被新版程序打开过：拒绝继续写，避免数据被旧逻辑破坏。
  const unknownVersion = [...applied].find((version) => version > latestVersion);
  if (unknownVersion !== undefined) {
    throw new Error(`运行数据库版本 ${unknownVersion} 高于当前程序支持的版本 ${latestVersion}`);
  }

  const insertMigration = database.prepare(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
  );

  for (const migration of runtimeMigrations) {
    if (applied.has(migration.version)) continue;

    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      insertMigration.run(migration.version, migration.name, new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  return runtimeMigrations.filter((migration) => !applied.has(migration.version));
}

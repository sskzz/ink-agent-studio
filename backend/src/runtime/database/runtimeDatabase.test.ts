// 运行数据库单测：WAL 与迁移应用、存量库迁移前自动备份。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspacePaths } from "../../modules/workspace/workspacePaths.js";
import { ensureWorkspace } from "../../modules/workspace/workspaceService.js";
import { pathExists } from "../../utils/fileStore.js";
import { RuntimeDatabase } from "./runtimeDatabase.js";

let tempRoot: string | null = null;
let runtimeDatabase: RuntimeDatabase | null = null;

afterEach(async () => {
  runtimeDatabase?.close();
  runtimeDatabase = null;
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

async function createDatabase(options: { existingFile?: boolean } = {}) {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-runtime-db-"));
  const paths = createWorkspacePaths(tempRoot);
  await ensureWorkspace(paths);
  if (options.existingFile) await writeFile(paths.runtimeDatabaseFile, "");
  runtimeDatabase = new RuntimeDatabase(paths);
  const initialized = await runtimeDatabase.initialize({ busyTimeoutMs: 1_500, backupBeforeMigration: true });
  return { paths, database: runtimeDatabase, initialized };
}

describe("RuntimeDatabase", () => {
  it("enables WAL and applies the versioned schema", async () => {
    const { database, initialized } = await createDatabase();

    expect(initialized.appliedMigrations.map((item) => item.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(database.database.prepare("PRAGMA journal_mode").get()?.journal_mode).toBe("wal");
    expect(database.database.prepare("PRAGMA foreign_keys").get()?.foreign_keys).toBe(1);
    const tables = database.database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
      .map((row) => row.name);
    expect(tables).toEqual(expect.arrayContaining([
      "schema_migrations",
      "runs",
      "run_events",
      "run_artifacts",
      "run_checkpoints",
      "model_attempts",
      "legacy_import_entries",
      "state_patches",
      "sessions",
      "session_messages",
      "session_messages_fts",
      "session_runs",
      "user_preferences",
      "chapter_memory",
      "chapter_memory_fts",
      "chapter_memory_embeddings",
      "story_state_events",
      "chapter_state_outbox"
    ]));
  });

  it("backs up an existing database before its first pending migration", async () => {
    const { initialized } = await createDatabase({ existingFile: true });

    expect(initialized.backupFile).not.toBeNull();
    await expect(pathExists(initialized.backupFile!)).resolves.toBe(true);
  });

  it("upgrades a populated v12 database to v13 and backs it up", async () => {
    const { paths, database } = await createDatabase();
    database.database.prepare(`
      INSERT INTO chapter_memory (
        book_id, chapter_id, chapter_no, chapter_revision, content_hash,
        summary, raw_text, synthesized_text, entities_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("book-legacy", "chapter-0001", 1, 1, "legacy-hash", "旧章摘要", "", "旧章事实", "[]", new Date(0).toISOString());
    database.close();
    runtimeDatabase = null;

    const legacy = new DatabaseSync(paths.runtimeDatabaseFile);
    legacy.exec("DROP TABLE chapter_memory_embeddings");
    legacy.prepare("DELETE FROM schema_migrations WHERE version = 13").run();
    legacy.close();

    runtimeDatabase = new RuntimeDatabase(paths);
    const initialized = await runtimeDatabase.initialize({ busyTimeoutMs: 1_500, backupBeforeMigration: true });

    expect(initialized.appliedMigrations).toEqual([{ version: 13, name: "add_chapter_memory_embeddings" }]);
    expect(initialized.backupFile).not.toBeNull();
    await expect(pathExists(initialized.backupFile!)).resolves.toBe(true);
    expect(runtimeDatabase.database.prepare("SELECT COUNT(*) AS count FROM chapter_memory").get()?.count).toBe(1);
    expect(runtimeDatabase.database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chapter_memory_embeddings'").get()?.name).toBe("chapter_memory_embeddings");
  });
});


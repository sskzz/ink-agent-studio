// 运行数据库单测：WAL 与迁移应用、存量库迁移前自动备份。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

    expect(initialized.appliedMigrations.map((item) => item.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
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
      "user_preferences"
    ]));
  });

  it("backs up an existing database before its first pending migration", async () => {
    const { initialized } = await createDatabase({ existingFile: true });

    expect(initialized.backupFile).not.toBeNull();
    await expect(pathExists(initialized.backupFile!)).resolves.toBe(true);
  });
});

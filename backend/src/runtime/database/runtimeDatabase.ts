import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { ensureDirectory, pathExists } from "../../utils/fileStore.js";
import type { WorkspacePaths } from "../../modules/workspace/workspacePaths.js";
import { applyRuntimeMigrations, readAppliedMigrationVersions, runtimeMigrations } from "./runtimeMigrations.js";

export interface RuntimeDatabaseOptions {
  busyTimeoutMs: number;
  backupBeforeMigration: boolean;
}

export interface RuntimeDatabaseInitialization {
  appliedMigrations: Array<{ version: number; name: string }>;
  backupFile: string | null;
}

/**
 * 管理运行态 SQLite 的唯一连接。作品正文和权威 BookState 不进入此数据库；这里仅保存
 * Run、事件、检查点、模型尝试等可重放运行数据。
 */
export class RuntimeDatabase {
  private connection: DatabaseSync | null = null;

  constructor(private readonly paths: WorkspacePaths) {}

  async initialize(options: RuntimeDatabaseOptions): Promise<RuntimeDatabaseInitialization> {
    if (this.connection) {
      return { appliedMigrations: [], backupFile: null };
    }

    await Promise.all([
      ensureDirectory(path.dirname(this.paths.runtimeDatabaseFile)),
      ensureDirectory(this.paths.backupsDir)
    ]);

    const databaseExisted = await pathExists(this.paths.runtimeDatabaseFile);
    const database = new DatabaseSync(this.paths.runtimeDatabaseFile, {
      timeout: options.busyTimeoutMs,
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false
    });
    this.connection = database;

    try {
      database.exec("PRAGMA journal_mode = WAL");
      database.exec("PRAGMA synchronous = NORMAL");
      database.exec("PRAGMA foreign_keys = ON");
      database.exec(`PRAGMA busy_timeout = ${Math.max(100, Math.trunc(options.busyTimeoutMs))}`);

      const appliedVersions = new Set(readAppliedMigrationVersions(database));
      const pendingMigrations = runtimeMigrations.filter((migration) => !appliedVersions.has(migration.version));
      let backupFile: string | null = null;

      if (databaseExisted && pendingMigrations.length > 0 && options.backupBeforeMigration) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        backupFile = path.join(this.paths.backupsDir, `runtime-before-v${pendingMigrations[0].version}-${stamp}.sqlite`);
        await backup(database, backupFile);
      }

      const appliedMigrations = applyRuntimeMigrations(database);
      return {
        appliedMigrations: appliedMigrations.map(({ version, name }) => ({ version, name })),
        backupFile
      };
    } catch (error) {
      this.close();
      throw error;
    }
  }

  get database() {
    if (!this.connection) {
      throw new Error("运行数据库尚未初始化");
    }
    return this.connection;
  }

  get initialized() {
    return this.connection !== null;
  }

  transaction<T>(operation: (database: DatabaseSync) => T): T {
    const database = this.database;
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation(database);
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    if (!this.connection) return;
    this.connection.close();
    this.connection = null;
  }
}

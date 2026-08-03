import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { ensureDirectory, pathExists } from "../../utils/fileStore.js";
import type { WorkspacePaths } from "../../modules/workspace/workspacePaths.js";
import { applyRuntimeMigrations, readAppliedMigrationVersions, runtimeMigrations } from "./runtimeMigrations.js";

/**
 * 运行数据库初始化选项。
 */
export interface RuntimeDatabaseOptions {
  busyTimeoutMs: number;
  backupBeforeMigration: boolean;
}

/**
 * 初始化结果：本次应用的迁移列表与迁移前备份文件（无备份时为 null）。
 */
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

  /**
   * 初始化 SQLite 连接并执行迁移。
   * 流程：建目录 → 打开连接 → 设置 WAL 等 PRAGMA → 有存量库且有待迁移版本时先备份 → 逐版本迁移。
   * 初始化失败时关闭连接并抛出，避免留下半初始化状态。
   */
  async initialize(options: RuntimeDatabaseOptions): Promise<RuntimeDatabaseInitialization> {
    if (this.connection) {
      // 幂等：重复调用直接返回空结果，防止并发启动路径重复迁移。
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
      // 关闭双引号字符串字面量，避免 SQL 注入式误写；禁扩展加载器。
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false
    });
    this.connection = database;

    try {
      // WAL 提高并发读写能力；synchronous=NORMAL 在断电安全与性能间取平衡。
      database.exec("PRAGMA journal_mode = WAL");
      database.exec("PRAGMA synchronous = NORMAL");
      database.exec("PRAGMA foreign_keys = ON");
      database.exec(`PRAGMA busy_timeout = ${Math.max(100, Math.trunc(options.busyTimeoutMs))}`);

      const appliedVersions = new Set(readAppliedMigrationVersions(database));
      const pendingMigrations = runtimeMigrations.filter((migration) => !appliedVersions.has(migration.version));
      let backupFile: string | null = null;

      // 升级前备份存量库：迁移不可回滚，备份是用户数据的最后防线。
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

  /** 访问已初始化的数据库连接；未初始化时抛错提示调用顺序错误。 */
  get database() {
    if (!this.connection) {
      throw new Error("运行数据库尚未初始化");
    }
    return this.connection;
  }

  /** 是否已初始化。 */
  get initialized() {
    return this.connection !== null;
  }

  /**
   * 在事务中执行操作。
   * 用 BEGIN IMMEDIATE 抢占写锁，避免读写并发时的死锁；失败自动回滚。
   */
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

  /** 关闭连接并置空引用，保证进程退出前 WAL 内容落盘。 */
  close() {
    if (!this.connection) return;
    this.connection.close();
    this.connection = null;
  }
}

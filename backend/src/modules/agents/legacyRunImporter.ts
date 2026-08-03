import { readFile } from "node:fs/promises";
import { agentRunRecordSchema } from "../../schemas/runSchemas.js";
import type { RuntimeDatabase } from "../../runtime/database/runtimeDatabase.js";
import { sha256 } from "../../utils/hash.js";
import { pathExists } from "../../utils/fileStore.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";

/** 旧 Run 导入结果统计：成功导入 / 跳过 / 坏行数量。 */
export interface LegacyRunImportSummary {
  imported: number;
  skipped: number;
  invalid: number;
}

/**
 * 旧 runs.jsonl 迁移器（文件职责）。
 * 把旧同步执行器写入的 runs.jsonl 迁移为可查询的 V2 运行记录：每一行以内容哈希记账，
 * 重复启动不会重复生成事件；坏行只记录诊断，不会阻止其余历史记录导入，也不会改写原 JSONL。
 */
export class LegacyRunImporter {
  constructor(
    private readonly runtimeDatabase: RuntimeDatabase,
    private readonly paths: WorkspacePaths
  ) {}

  /**
   * 执行导入：逐行读取 runs.jsonl，校验 schema 后写入 runs / run_events / legacy_import_entries。
   * 返回值：导入统计摘要。无 JSONL 文件时直接返回全零摘要（幂等入口，可随启动重复调用）。
   */
  async import() : Promise<LegacyRunImportSummary> {
    const summary: LegacyRunImportSummary = { imported: 0, skipped: 0, invalid: 0 };
    if (!(await pathExists(this.paths.runsLogFile))) return summary;

    const lines = (await readFile(this.paths.runsLogFile, "utf8")).split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) continue;
      const contentHash = sha256(line);

      // 内容哈希幂等记账：同一行已导入过则跳过，保证服务重启重复执行不产生重复事件。
      const alreadyImported = this.runtimeDatabase.database.prepare(`
        SELECT 1 FROM legacy_import_entries WHERE source_path = ? AND content_hash = ?
      `).get(this.paths.runsLogFile, contentHash);
      if (alreadyImported) {
        summary.skipped += 1;
        continue;
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(line);
      } catch (error) {
        this.recordInvalid(contentHash, index + 1, error);
        summary.invalid += 1;
        continue;
      }

      const parsed = agentRunRecordSchema.safeParse(parsedJson);
      if (!parsed.success) {
        this.recordInvalid(contentHash, index + 1, parsed.error);
        summary.invalid += 1;
        continue;
      }

      const importStatus = this.importRecord(parsed.data, contentHash, index + 1);
      if (importStatus === "imported") summary.imported += 1;
      else summary.skipped += 1;
    }

    return summary;
  }

  /**
   * 导入单条旧 Run 记录（事务内执行）。
   * 处理三种情况：已有 native 运行同 ID（跳过记账）；无记录（创建 legacy_import 命令快照 +
   * run_created/run_started 事件）；已有 legacy 记录（按状态追加终态事件并更新快照）。
   */
  private importRecord(
    record: ReturnType<typeof agentRunRecordSchema.parse>,
    contentHash: string,
    lineNumber: number
  ) {
    return this.runtimeDatabase.transaction((database) => {
      const existing = database.prepare("SELECT id, origin, status, last_event_seq FROM runs WHERE id = ?").get(record.id);
      const importedAt = new Date().toISOString();

      // 同 ID 已被 native 运行占用时不覆盖，避免新运行记录被旧数据污染。
      if (existing && existing.origin !== "legacy_jsonl") {
        insertLedger(database, this.paths.runsLogFile, contentHash, lineNumber, record.id, "skipped_native", null, importedAt);
        return "skipped_native" as const;
      }

      if (!existing) {
        // 首次导入：创建 legacy_import 命令快照，并补 run_created / run_started 两个基础事件。
        const command = {
          schemaVersion: "legacy-run-command.v1",
          type: "legacy_import",
          legacyRunType: record.runType,
          bookId: record.bookId,
          input: record.inputJson
        };
        database.prepare(`
          INSERT INTO runs (
            id, schema_version, command_type, command_json, book_id, chapter_id,
            parent_run_id, root_run_id, status, current_stage, config_revision, config_hash,
            output_json, error_json, cancel_requested_at, last_event_seq,
            created_at, queued_at, started_at, finished_at, updated_at, origin
          ) VALUES (?, 'run-snapshot.v1', 'legacy_import', ?, ?, NULL, NULL, ?, 'queued', NULL, NULL, NULL,
            NULL, NULL, NULL, -1, ?, ?, NULL, NULL, ?, 'legacy_jsonl')
        `).run(
          record.id,
          JSON.stringify(command),
          record.bookId,
          record.id,
          record.startedAt,
          record.startedAt,
          record.startedAt
        );
        insertLegacyEvent(database, record.id, 0, `legacy-created:${record.id}`, "run_created", record.startedAt, {
          origin: "legacy_jsonl",
          legacyRunType: record.runType
        });
        insertLegacyEvent(database, record.id, 1, `legacy-started:${record.id}`, "run_started", record.startedAt, {});
      }

      const current = database.prepare("SELECT status, last_event_seq FROM runs WHERE id = ?").get(record.id);
      if (!current) throw new Error(`导入运行 ${record.id} 时未能创建快照`);
      const target = mapLegacyStatus(record.status);
      // 旧版 queued/running 映射为 interrupted；已有终态时不再追加事件，保持事件流单调。
      const shouldApply = target !== "interrupted" || current.status === "queued" || current.status === "running";

      if (shouldApply) {
        const seq = Number(current.last_event_seq) + 1;
        const eventType = mapLegacyEventType(target);
        const timestamp = record.finishedAt ?? importedAt;
        insertLegacyEvent(database, record.id, seq, `legacy-snapshot:${contentHash}`, eventType, timestamp, {
          ...(target === "completed" ? { output: record.outputJson } : {}),
          ...(target === "failed" ? { error: { message: record.errorMessage ?? "旧版运行失败" } } : {}),
          ...(target === "interrupted" ? { reason: "后端重启时导入了未完成的旧版运行" } : {}),
          legacy: {
            tokenUsage: record.tokenUsageJson,
            styleTrace: record.styleTraceJson,
            modelConfigId: record.modelConfigId,
            promptVersion: record.promptVersion
          }
        });
        database.prepare(`
          UPDATE runs SET status = ?, output_json = ?, error_json = ?, last_event_seq = ?,
            started_at = ?, finished_at = ?, updated_at = ? WHERE id = ?
        `).run(
          target,
          record.outputJson === null ? null : JSON.stringify(record.outputJson),
          target === "failed" ? JSON.stringify({ message: record.errorMessage ?? "旧版运行失败" }) :
            target === "interrupted" ? JSON.stringify({ reason: "后端重启时导入了未完成的旧版运行" }) : null,
          seq,
          record.startedAt,
          target === "interrupted" ? importedAt : record.finishedAt,
          timestamp,
          record.id
        );
      }

      insertLedger(database, this.paths.runsLogFile, contentHash, lineNumber, record.id, "imported", null, importedAt);
      return "imported" as const;
    });
  }

  /** 记录坏行诊断：写入记账表但不中断整体导入。 */
  private recordInvalid(contentHash: string, lineNumber: number, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.runtimeDatabase.transaction((database) => {
      insertLedger(
        database,
        this.paths.runsLogFile,
        contentHash,
        lineNumber,
        null,
        "invalid",
        message.slice(0, 2_000),
        new Date().toISOString()
      );
    });
  }
}

/** 旧状态映射：queued/running 表示进程重启时未完成，统一映射为可恢复的 interrupted。 */
function mapLegacyStatus(status: "queued" | "running" | "completed" | "failed" | "cancelled") {
  return status === "queued" || status === "running" ? "interrupted" : status;
}

/** 终态映射到对应的运行事件类型。 */
function mapLegacyEventType(status: ReturnType<typeof mapLegacyStatus>) {
  if (status === "completed") return "run_completed";
  if (status === "failed") return "run_failed";
  if (status === "cancelled") return "run_cancelled";
  return "run_interrupted";
}

/**
 * 插入一条 legacy 事件（INSERT OR IGNORE 幂等），并同步抬升 last_event_seq。
 * 入参：database——事务内连接；runId/seq/eventId/eventType/timestamp/payload。
 */
function insertLegacyEvent(
  database: import("node:sqlite").DatabaseSync,
  runId: string,
  seq: number,
  eventId: string,
  eventType: string,
  timestamp: string,
  payload: Record<string, unknown>
) {
  database.prepare(`
    INSERT OR IGNORE INTO run_events (
      run_id, seq, event_id, event_type, stage, timestamp, payload_json, artifact_refs_json
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, '[]')
  `).run(runId, seq, eventId, eventType, timestamp, JSON.stringify(payload));
  database.prepare("UPDATE runs SET last_event_seq = MAX(last_event_seq, ?) WHERE id = ?").run(seq, runId);
}

/** 写入导入记账表：source_path + content_hash 唯一，用于幂等去重与诊断。 */
function insertLedger(
  database: import("node:sqlite").DatabaseSync,
  sourcePath: string,
  contentHash: string,
  lineNumber: number,
  legacyRunId: string | null,
  status: "imported" | "skipped_native" | "invalid",
  errorMessage: string | null,
  importedAt: string
) {
  database.prepare(`
    INSERT INTO legacy_import_entries (
      source_path, content_hash, line_number, legacy_run_id, import_status, error_message, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sourcePath, contentHash, lineNumber, legacyRunId, status, errorMessage, importedAt);
}

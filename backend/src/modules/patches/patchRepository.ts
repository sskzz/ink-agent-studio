/**
 * 状态 Patch 仓储。
 * 职责：state_patches 表的持久化——创建、按 id/作品/状态查询与状态字段更新；
 * 边界：target 以 target_kind + target_id 两列存储，读取时还原为结构化对象；update 只允许更新状态相关字段（内容不可变）。
 */
import { statePatchSchema, type StatePatch, type StatePatchStatus } from "@ink-agent/contracts";
import type { RuntimeDatabase } from "../../runtime/database/runtimeDatabase.js";
import { notFound } from "../../utils/errors.js";

export class PatchRepository {
  constructor(private readonly runtimeDatabase: RuntimeDatabase) {}

  /** 创建 Patch 记录（全字段插入）。 */
  create(patch: StatePatch) {
    const targetId = patch.target.kind === "book_file" ? patch.target.fileId : patch.target.chapterId;
    this.runtimeDatabase.database.prepare(`
      INSERT INTO state_patches (
        id, schema_version, run_id, book_id, target_kind, target_id, status, reason,
        base_hash, proposed_hash, proposed_content, backup_file, error_message,
        created_at, updated_at, applied_at, rejected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      patch.id,
      patch.schemaVersion,
      patch.runId,
      patch.bookId,
      patch.target.kind,
      targetId,
      patch.status,
      patch.reason,
      patch.baseHash,
      patch.proposedHash,
      patch.proposedContent,
      patch.backupFile,
      patch.error,
      patch.createdAt,
      patch.updatedAt,
      patch.appliedAt,
      patch.rejectedAt
    );
    return patch;
  }

  /** 按 id 读取 Patch；不存在时抛 notFound。 */
  get(patchId: string) {
    const row = this.runtimeDatabase.database.prepare("SELECT * FROM state_patches WHERE id = ?").get(patchId);
    if (!row) throw notFound("状态 Patch 不存在", { patchId });
    return mapPatchRow(row);
  }

  /** 按作品列出 Patch（创建时间倒序）。 */
  listByBook(bookId: string) {
    return this.runtimeDatabase.database.prepare(
      "SELECT * FROM state_patches WHERE book_id = ? ORDER BY created_at DESC"
    ).all(bookId).map(mapPatchRow);
  }

  /** 按状态列出 Patch（用于启动时恢复 applying 记录）。 */
  listByStatus(status: StatePatchStatus) {
    return this.runtimeDatabase.database.prepare(
      "SELECT * FROM state_patches WHERE status = ? ORDER BY updated_at"
    ).all(status).map(mapPatchRow);
  }

  /** 更新状态字段（status/backup/error/时间戳）；内容与哈希字段不可变。 */
  update(patch: StatePatch) {
    this.runtimeDatabase.database.prepare(`
      UPDATE state_patches SET
        status = ?, backup_file = ?, error_message = ?, updated_at = ?, applied_at = ?, rejected_at = ?
      WHERE id = ?
    `).run(
      patch.status,
      patch.backupFile,
      patch.error,
      patch.updatedAt,
      patch.appliedAt,
      patch.rejectedAt,
      patch.id
    );
    return patch;
  }
}

/** 行 → 实体映射：target 由 target_kind/target_id 还原为对象并按 schema 校验。 */
function mapPatchRow(row: Record<string, unknown>) {
  const target = row.target_kind === "book_file"
    ? { kind: "book_file" as const, fileId: String(row.target_id) }
    : { kind: "chapter" as const, chapterId: String(row.target_id) };
  return statePatchSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    runId: row.run_id,
    bookId: row.book_id,
    target,
    status: row.status,
    reason: row.reason,
    baseHash: row.base_hash,
    proposedHash: row.proposed_hash,
    proposedContent: row.proposed_content,
    backupFile: row.backup_file,
    error: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    appliedAt: row.applied_at,
    rejectedAt: row.rejected_at
  });
}

/**
 * 用户偏好记忆仓储。
 * 职责：管理 user_preferences 表的持久化与状态机流转（proposed → active/rejected → archived）；
 * 边界：只做 SQL 存取与状态校验，不包含 Prompt 组装逻辑；批准新偏好时自动归档同键的旧 active 偏好（版本替换语义）。
 */
import { randomUUID } from "node:crypto";
import { userPreferenceSchema, type UserPreference, type UserPreferenceProposalInput } from "@ink-agent/contracts";
import type { RuntimeDatabase } from "../../runtime/database/runtimeDatabase.js";
import { conflict, notFound } from "../../utils/errors.js";
import { estimateTokens } from "../prompts/promptAssembler.js";

export class PreferenceRepository {
  constructor(private readonly runtimeDatabase: RuntimeDatabase) {}

  /** 数据库连接是否已初始化。 */
  get initialized() {
    return this.runtimeDatabase.initialized;
  }

  /**
   * 提交偏好提案（status=proposed，等待审批）。
   * 校验来源 Session/消息引用有效后入库；tokenEstimate 供 Prompt 预算使用。
   */
  propose(input: UserPreferenceProposalInput) {
    const now = new Date().toISOString();
    const preference: UserPreference = {
      schemaVersion: "user-preference.v1",
      id: randomUUID(),
      category: input.category,
      key: input.key,
      value: input.value.trim(),
      reason: input.reason.trim(),
      rejectionReason: null,
      status: "proposed",
      priority: input.priority,
      tokenEstimate: estimateTokens(`${input.key}：${input.value}`),
      sourceSessionId: input.sourceSessionId,
      sourceMessageId: input.sourceMessageId,
      replacesPreferenceId: null,
      createdAt: now,
      updatedAt: now,
      approvedAt: null,
      rejectedAt: null,
      archivedAt: null
    };
    this.runtimeDatabase.transaction((database) => {
      assertSourceReferences(database, input.sourceSessionId, input.sourceMessageId);
      insertPreference(database, preference);
    });
    return preference;
  }

  /** 按 id 读取偏好；不存在时抛 notFound。 */
  get(id: string) {
    const row = this.runtimeDatabase.database.prepare("SELECT * FROM user_preferences WHERE id = ?").get(id);
    if (!row) throw notFound("偏好记忆不存在", { id });
    return mapPreferenceRow(row);
  }

  /** 列表查询：可按状态过滤；按优先级降序、更新时间降序取 limit 条。 */
  list(options: { status?: UserPreference["status"]; limit: number }) {
    if (options.status) {
      return this.runtimeDatabase.database.prepare(
        "SELECT * FROM user_preferences WHERE status = ? ORDER BY priority DESC, updated_at DESC LIMIT ?"
      ).all(options.status, options.limit).map(mapPreferenceRow);
    }
    return this.runtimeDatabase.database.prepare(
      "SELECT * FROM user_preferences ORDER BY updated_at DESC LIMIT ?"
    ).all(options.limit).map(mapPreferenceRow);
  }

  /**
   * 批准偏好（proposed → active）。
   * 同一 key 已有 active 偏好时先归档旧记录，并通过 replaces_preference_id 记录替换关系（保证同一偏好只有一条生效）。
   * 幂等：已是 active 直接返回。
   */
  approve(id: string) {
    return this.runtimeDatabase.transaction((database) => {
      const current = readPreference(database, id);
      if (!current) throw notFound("偏好记忆不存在", { id });
      if (current.status === "active") return current;
      if (current.status !== "proposed") throw conflict("只有 proposed 偏好可以批准", { id, status: current.status });
      // 同一 key 只允许一条 active：先归档旧记录
      const previousRow = database.prepare(
        "SELECT * FROM user_preferences WHERE preference_key = ? AND status = 'active'"
      ).get(current.key);
      const previous = previousRow ? mapPreferenceRow(previousRow) : null;
      const now = new Date().toISOString();
      if (previous) {
        database.prepare(
          "UPDATE user_preferences SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?"
        ).run(now, now, previous.id);
      }
      database.prepare(`
        UPDATE user_preferences SET status = 'active', approved_at = ?, updated_at = ?, replaces_preference_id = ?
        WHERE id = ?
      `).run(now, now, previous?.id ?? null, id);
      return readPreference(database, id)!;
    });
  }

  /** 拒绝偏好（proposed → rejected），需提供原因；幂等：已是 rejected 直接返回。 */
  reject(id: string, reason: string) {
    const current = this.get(id);
    if (current.status === "rejected") return current;
    if (current.status !== "proposed") throw conflict("只有 proposed 偏好可以拒绝", { id, status: current.status });
    const now = new Date().toISOString();
    this.runtimeDatabase.database.prepare(`
      UPDATE user_preferences SET status = 'rejected', rejection_reason = ?, rejected_at = ?, updated_at = ? WHERE id = ?
    `).run(reason.trim(), now, now, id);
    return this.get(id);
  }

  /** 归档偏好（active → archived，通常由批准新同键偏好触发或手动清理）；幂等处理。 */
  archive(id: string) {
    const current = this.get(id);
    if (current.status === "archived") return current;
    if (current.status !== "active") throw conflict("只有 active 偏好可以归档", { id, status: current.status });
    const now = new Date().toISOString();
    this.runtimeDatabase.database.prepare(
      "UPDATE user_preferences SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?"
    ).run(now, now, id);
    return this.get(id);
  }
}

/** 插入偏好记录（全字段 INSERT）。 */
function insertPreference(database: import("node:sqlite").DatabaseSync, preference: UserPreference) {
  database.prepare(`
    INSERT INTO user_preferences (
      id, schema_version, category, preference_key, value, reason, rejection_reason, status, priority,
      token_estimate, source_session_id, source_message_id, replaces_preference_id,
      created_at, updated_at, approved_at, rejected_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    preference.id, preference.schemaVersion, preference.category, preference.key, preference.value,
    preference.reason, preference.rejectionReason, preference.status, preference.priority, preference.tokenEstimate,
    preference.sourceSessionId, preference.sourceMessageId, preference.replacesPreferenceId,
    preference.createdAt, preference.updatedAt, preference.approvedAt, preference.rejectedAt, preference.archivedAt
  );
}

/** 引用完整性校验：提案必须指向真实存在的 Session；带消息时必须同属该 Session，防止跨会话伪造来源。 */
function assertSourceReferences(database: import("node:sqlite").DatabaseSync, sessionId: string | null, messageId: string | null) {
  if (sessionId && !database.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId)) {
    throw notFound("来源 Session 不存在", { sessionId });
  }
  if (messageId) {
    if (!sessionId) {
      throw conflict("关联来源消息时必须同时提供来源 Session", { messageId });
    }
    const message = database.prepare("SELECT session_id FROM session_messages WHERE id = ?").get(messageId);
    if (!message || message.session_id !== sessionId) {
      throw conflict("来源消息不存在或不属于指定 Session", { sessionId, messageId });
    }
  }
}

function readPreference(database: import("node:sqlite").DatabaseSync, id: string) {
  const row = database.prepare("SELECT * FROM user_preferences WHERE id = ?").get(id);
  return row ? mapPreferenceRow(row) : null;
}

/** 行 → 实体映射：snake_case 转 camelCase 并按 schema 校验，保证非法行数据在读取边界被拦截。 */
function mapPreferenceRow(row: Record<string, unknown>) {
  return userPreferenceSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    category: row.category,
    key: row.preference_key,
    value: row.value,
    reason: row.reason,
    rejectionReason: row.rejection_reason,
    status: row.status,
    priority: Number(row.priority),
    tokenEstimate: Number(row.token_estimate),
    sourceSessionId: row.source_session_id,
    sourceMessageId: row.source_message_id,
    replacesPreferenceId: row.replaces_preference_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at,
    rejectedAt: row.rejected_at,
    archivedAt: row.archived_at
  });
}

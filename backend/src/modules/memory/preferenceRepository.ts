import { randomUUID } from "node:crypto";
import { userPreferenceSchema, type UserPreference, type UserPreferenceProposalInput } from "@ink-agent/contracts";
import type { RuntimeDatabase } from "../../runtime/database/runtimeDatabase.js";
import { conflict, notFound } from "../../utils/errors.js";
import { estimateTokens } from "../prompts/promptAssembler.js";

export class PreferenceRepository {
  constructor(private readonly runtimeDatabase: RuntimeDatabase) {}

  get initialized() {
    return this.runtimeDatabase.initialized;
  }

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

  get(id: string) {
    const row = this.runtimeDatabase.database.prepare("SELECT * FROM user_preferences WHERE id = ?").get(id);
    if (!row) throw notFound("偏好记忆不存在", { id });
    return mapPreferenceRow(row);
  }

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

  approve(id: string) {
    return this.runtimeDatabase.transaction((database) => {
      const current = readPreference(database, id);
      if (!current) throw notFound("偏好记忆不存在", { id });
      if (current.status === "active") return current;
      if (current.status !== "proposed") throw conflict("只有 proposed 偏好可以批准", { id, status: current.status });
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

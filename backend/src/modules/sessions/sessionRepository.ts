import { randomUUID } from "node:crypto";
import {
  sessionMessageCreateInputSchema,
  sessionMessageSchema,
  sessionSchema,
  type Session,
  type SessionMessage,
  type SessionSearchInput,
  type SessionSearchResult
} from "@ink-agent/contracts";
import type { DatabaseSync } from "node:sqlite";
import type { RuntimeDatabase } from "../../runtime/database/runtimeDatabase.js";
import { conflict, notFound } from "../../utils/errors.js";
import { sha256 } from "../../utils/hash.js";
import { estimateTokens } from "../prompts/promptAssembler.js";

export class SessionRepository {
  constructor(private readonly runtimeDatabase: RuntimeDatabase) {}

  create(input: { bookId: string | null; title: string; parentSessionId: string | null }) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const session: Session = {
      schemaVersion: "session.v1",
      id,
      bookId: input.bookId,
      title: input.title,
      status: "active",
      parentSessionId: input.parentSessionId,
      lastMessageAt: null,
      createdAt: now,
      updatedAt: now
    };
    this.runtimeDatabase.transaction((database) => {
      if (input.parentSessionId && !readSessionRow(database, input.parentSessionId)) {
        throw notFound("父 Session 不存在", { parentSessionId: input.parentSessionId });
      }
      database.prepare(`
        INSERT INTO sessions (
          id, schema_version, book_id, title, status, parent_session_id,
          last_message_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(id, session.schemaVersion, session.bookId, session.title, session.status, session.parentSessionId, now, now);
    });
    return session;
  }

  get(sessionId: string) {
    const row = readSessionRow(this.runtimeDatabase.database, sessionId);
    if (!row) throw notFound("Session 不存在", { sessionId });
    return mapSessionRow(row);
  }

  list(options: { bookId?: string; limit: number }) {
    if (options.bookId) {
      return this.runtimeDatabase.database.prepare(
        "SELECT * FROM sessions WHERE book_id = ? ORDER BY updated_at DESC LIMIT ?"
      ).all(options.bookId, options.limit).map(mapSessionRow);
    }
    return this.runtimeDatabase.database.prepare(
      "SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?"
    ).all(options.limit).map(mapSessionRow);
  }

  archive(sessionId: string) {
    const current = this.get(sessionId);
    if (current.status === "archived") return current;
    const updatedAt = new Date().toISOString();
    this.runtimeDatabase.database.prepare(
      "UPDATE sessions SET status = 'archived', updated_at = ? WHERE id = ?"
    ).run(updatedAt, sessionId);
    return this.get(sessionId);
  }

  addMessage(sessionId: string, rawInput: unknown) {
    const input = sessionMessageCreateInputSchema.parse(rawInput);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    return this.runtimeDatabase.transaction((database) => {
      const sessionRow = readSessionRow(database, sessionId);
      if (!sessionRow) throw notFound("Session 不存在", { sessionId });
      const session = mapSessionRow(sessionRow);
      if (session.status !== "active") throw conflict("已归档 Session 不能追加消息", { sessionId });

      if (input.parentMessageId) {
        const parent = database.prepare(
          "SELECT session_id FROM session_messages WHERE id = ?"
        ).get(input.parentMessageId);
        if (!parent || parent.session_id !== sessionId) {
          throw conflict("父消息不属于当前 Session", { sessionId, parentMessageId: input.parentMessageId });
        }
      }

      const message: SessionMessage = {
        schemaVersion: "session-message.v1",
        id,
        sessionId,
        bookId: session.bookId,
        parentMessageId: input.parentMessageId ?? null,
        role: input.role,
        content: input.content,
        contentHash: sha256(input.content),
        tokenEstimate: estimateTokens(input.content),
        metadata: input.metadata ?? {},
        createdAt
      };
      database.prepare(`
        INSERT INTO session_messages (
          id, schema_version, session_id, book_id, parent_message_id, role,
          content, content_hash, token_estimate, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        message.id,
        message.schemaVersion,
        message.sessionId,
        message.bookId,
        message.parentMessageId,
        message.role,
        message.content,
        message.contentHash,
        message.tokenEstimate,
        JSON.stringify(message.metadata),
        message.createdAt
      );
      const nextTitle = session.title || (message.role === "user" ? createTitle(message.content) : "");
      database.prepare(
        "UPDATE sessions SET title = ?, last_message_at = ?, updated_at = ? WHERE id = ?"
      ).run(nextTitle, createdAt, createdAt, sessionId);
      return message;
    });
  }

  listMessages(sessionId: string, limit: number) {
    this.get(sessionId);
    return this.runtimeDatabase.database.prepare(`
      SELECT * FROM (
        SELECT *, rowid AS message_rowid FROM session_messages
        WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?
      ) ORDER BY created_at, message_rowid
    `).all(sessionId, limit).map(mapMessageRow);
  }

  search(input: SessionSearchInput & { limit: number }): SessionSearchResult[] {
    return input.query.length >= 3 ? this.searchFts(input) : this.searchLike(input);
  }

  private searchFts(input: SessionSearchInput & { limit: number }) {
    try {
      const rows = this.runtimeDatabase.database.prepare(`
        SELECT m.*, bm25(session_messages_fts) AS search_rank,
          snippet(session_messages_fts, 2, '[', ']', '…', 24) AS search_snippet
        FROM session_messages_fts
        JOIN session_messages m ON m.rowid = session_messages_fts.rowid
        WHERE session_messages_fts MATCH ?
          AND (? IS NULL OR m.session_id = ?)
          AND (? IS NULL OR m.book_id = ?)
        ORDER BY search_rank, m.created_at DESC
        LIMIT ?
      `).all(
        quoteFts(input.query),
        input.sessionId ?? null,
        input.sessionId ?? null,
        input.bookId ?? null,
        input.bookId ?? null,
        input.limit
      );
      return rows.map((row) => ({
        message: mapMessageRow(row),
        snippet: String(row.search_snippet ?? ""),
        rank: row.search_rank === null ? null : Number(row.search_rank)
      }));
    } catch {
      return this.searchLike(input);
    }
  }

  private searchLike(input: SessionSearchInput & { limit: number }) {
    const escaped = input.query.replace(/[\\%_]/g, "\\$&");
    const rows = this.runtimeDatabase.database.prepare(`
      SELECT * FROM session_messages
      WHERE content LIKE ? ESCAPE '\\'
        AND (? IS NULL OR session_id = ?)
        AND (? IS NULL OR book_id = ?)
      ORDER BY created_at DESC
      LIMIT ?
    `).all(
      `%${escaped}%`,
      input.sessionId ?? null,
      input.sessionId ?? null,
      input.bookId ?? null,
      input.bookId ?? null,
      input.limit
    );
    return rows.map((row) => ({ message: mapMessageRow(row), snippet: String(row.content), rank: null }));
  }
}

function readSessionRow(database: DatabaseSync, sessionId: string) {
  return database.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
}

function mapSessionRow(row: Record<string, unknown>) {
  return sessionSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    bookId: row.book_id,
    title: row.title,
    status: row.status,
    parentSessionId: row.parent_session_id,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapMessageRow(row: Record<string, unknown>) {
  return sessionMessageSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    sessionId: row.session_id,
    bookId: row.book_id,
    parentMessageId: row.parent_message_id,
    role: row.role,
    content: row.content,
    contentHash: row.content_hash,
    tokenEstimate: Number(row.token_estimate),
    metadata: JSON.parse(String(row.metadata_json)) as unknown,
    createdAt: row.created_at
  });
}

function quoteFts(query: string) {
  return `"${query.replace(/"/g, '""')}"`;
}

function createTitle(content: string) {
  const compact = content.replace(/\s+/g, " ").trim();
  return Array.from(compact).slice(0, 60).join("");
}

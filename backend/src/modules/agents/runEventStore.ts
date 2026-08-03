import { randomUUID } from "node:crypto";
import {
  runEventSchema,
  runSnapshotSchema,
  type ModelAttempt,
  type RunCommand,
  type RunEvent,
  type RunEventType,
  type RunSnapshot
} from "@ink-agent/contracts";
import type { DatabaseSync } from "node:sqlite";
import type { RuntimeDatabase } from "../../runtime/database/runtimeDatabase.js";
import { conflict, notFound } from "../../utils/errors.js";
import { sha256 } from "../../utils/hash.js";
import type { RunEventHub } from "./runEventHub.js";

interface AppendRunEventInput {
  eventId?: string;
  type: RunEventType;
  stage?: string | null;
  timestamp?: string;
  payload?: Record<string, unknown>;
  artifactRefs?: string[];
}

interface CreateRunInput {
  id?: string;
  command: RunCommand;
  parentRunId?: string | null;
  sessionId?: string | null;
  triggerMessageId?: string | null;
  configRevision: number;
  configHash: string;
  createdAt?: string;
}

export interface RunArtifactRecord {
  id: string;
  runId: string;
  artifactType: string;
  mimeType: string;
  storageKind: "inline_json" | "file";
  inlineJson: unknown | null;
  filePath: string | null;
  contentHash: string;
  byteSize: number;
  createdAt: string;
}

export interface RunCheckpointRecord {
  id: string;
  runId: string;
  eventSeq: number;
  stage: string;
  checkpoint: unknown;
  resumable: boolean;
  createdAt: string;
}

interface RunProjection {
  status: RunSnapshot["status"];
  currentStage: string | null;
  output: unknown | null;
  error: unknown | null;
  cancelRequestedAt: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

interface StoredEventResult {
  event: RunEvent;
  inserted: boolean;
}

const inFlightEventTypes = new Set<RunEventType>([
  "stage_progress",
  "model_attempt_started",
  "model_delta",
  "model_attempt_completed",
  "tool_started",
  "tool_completed",
  "review_completed",
  "degraded",
  "checkpoint_saved"
]);

/**
 * RunEventStore 是 Run V2 的唯一写入口。事件插入和快照投影处于同一事务，任何一步失败都会
 * 整体回滚，因此调用方不会看到“事件已写入但状态未更新”的半完成数据。
 */
export class RunEventStore {
  constructor(
    private readonly runtimeDatabase: RuntimeDatabase,
    private readonly eventHub?: RunEventHub
  ) {}

  /**
   * 创建 Run 快照并写入 run_created / run_queued 事件（同一事务）。
   * 入参：command 命令、父子关系、session/触发消息、配置版本与哈希。
   * 失败处理：父 Run、Session、触发消息任一不满足约束都会抛出冲突/未找到错误并整体回滚。
   */
  createRun(input: CreateRunInput) {
    const id = input.id ?? randomUUID();
    const createdAt = input.createdAt ?? new Date().toISOString();

    const events = this.runtimeDatabase.transaction((database) => {
      const parent = input.parentRunId ? readRunRow(database, input.parentRunId) : undefined;
      if (input.parentRunId && !parent) {
        throw notFound("父运行记录不存在", { parentRunId: input.parentRunId });
      }

      if (input.sessionId) {
        const session = database.prepare("SELECT book_id, status FROM sessions WHERE id = ?").get(input.sessionId);
        if (!session) throw notFound("Session 不存在", { sessionId: input.sessionId });
        if (session.status !== "active") throw conflict("已归档 Session 不能创建 Run", { sessionId: input.sessionId });
        if (session.book_id !== null && session.book_id !== input.command.bookId) {
          throw conflict("Session 与 Run 作品不一致", { sessionId: input.sessionId, bookId: input.command.bookId });
        }
        if (parent?.session_id && parent.session_id !== input.sessionId) {
          throw conflict("父 Run 属于其他 Session", { parentRunId: input.parentRunId, sessionId: input.sessionId });
        }
        if (input.triggerMessageId) {
          const message = database.prepare("SELECT session_id FROM session_messages WHERE id = ?").get(input.triggerMessageId);
          if (!message || message.session_id !== input.sessionId) {
            throw conflict("触发消息不属于当前 Session", { sessionId: input.sessionId, triggerMessageId: input.triggerMessageId });
          }
        }
      } else if (input.triggerMessageId) {
        throw conflict("triggerMessageId 必须与 sessionId 同时提供");
      }

      const rootRunId = parent ? String(parent.root_run_id) : id;
      const chapterId = "chapterId" in input.command ? input.command.chapterId : null;
      database.prepare(`
        INSERT INTO runs (
          id, schema_version, command_type, command_json, book_id, chapter_id,
          parent_run_id, root_run_id, status, current_stage, config_revision, config_hash,
          output_json, error_json, cancel_requested_at, last_event_seq,
          created_at, queued_at, started_at, finished_at, updated_at, origin,
          session_id, trigger_message_id
        ) VALUES (?, 'run-snapshot.v1', ?, ?, ?, ?, ?, ?, 'queued', NULL, ?, ?, NULL, NULL, NULL, -1, ?, ?, NULL, NULL, ?, 'native', ?, ?)
      `).run(
        id,
        input.command.type,
        stringifyJson(input.command),
        input.command.bookId,
        chapterId,
        input.parentRunId ?? null,
        rootRunId,
        input.configRevision,
        input.configHash,
        createdAt,
        createdAt,
        createdAt,
        input.sessionId ?? null,
        input.triggerMessageId ?? null
      );

      if (input.sessionId) {
        database.prepare(`
          INSERT INTO session_runs (session_id, run_id, trigger_message_id, response_message_id, created_at)
          VALUES (?, ?, ?, NULL, ?)
        `).run(input.sessionId, id, input.triggerMessageId ?? null, createdAt);
      }

      const created = appendEventInTransaction(database, id, {
        type: "run_created",
        timestamp: createdAt,
        payload: {
          commandType: input.command.type,
          configRevision: input.configRevision,
          configHash: input.configHash
        }
      });
      const queued = appendEventInTransaction(database, id, {
        type: "run_queued",
        timestamp: createdAt,
        payload: {}
      });
      return [created.event, queued.event];
    });

    events.forEach((event) => this.eventHub?.publish(event));

    return this.getRun(id);
  }

  /**
   * 追加一条运行事件（事务内写入 + 投影更新），落库成功后推送给在线 SSE 订阅者。
   * 返回值：事件记录与更新后的 Run 快照。
   */
  appendEvent(runId: string, input: AppendRunEventInput) {
    const result = this.runtimeDatabase.transaction((database) => appendEventInTransaction(database, runId, input));
    if (result.inserted) this.eventHub?.publish(result.event);
    return { event: result.event, snapshot: this.getRun(runId) };
  }

  /** 读取 Run 快照；不存在时抛 notFound。 */
  getRun(runId: string) {
    const row = readRunRow(this.runtimeDatabase.database, runId);
    if (!row) throw notFound("运行记录不存在", { runId });
    return mapRunRow(row);
  }

  /**
   * 按 seq 续接读取事件（SSE 重放与断点续接使用）。
   * 入参：afterSeq——只返回大于该序号的事件（默认 -1 全量）；limit——最多条数（默认 5000）。
   */
  listEvents(runId: string, options: { afterSeq?: number; limit?: number } = {}) {
    if (!readRunRow(this.runtimeDatabase.database, runId)) {
      throw notFound("运行记录不存在", { runId });
    }

    const afterSeq = Math.max(-1, Math.trunc(options.afterSeq ?? -1));
    const limit = Math.min(100_000, Math.max(1, Math.trunc(options.limit ?? 5_000)));
    return this.runtimeDatabase.database.prepare(`
      SELECT run_id, seq, event_id, event_type, stage, timestamp, payload_json, artifact_refs_json
      FROM run_events
      WHERE run_id = ? AND seq > ?
      ORDER BY seq
      LIMIT ?
    `).all(runId, afterSeq, limit).map(mapEventRow);
  }

  /** 按状态集合列出 Run（启动恢复与中断扫描使用，按创建时间升序）。 */
  listRunsByStatus(statuses: RunSnapshot["status"][], limit = 10_000) {
    if (statuses.length === 0) return [];
    const placeholders = statuses.map(() => "?").join(", ");
    return this.runtimeDatabase.database.prepare(`
      SELECT * FROM runs
      WHERE status IN (${placeholders})
      ORDER BY created_at
      LIMIT ?
    `).all(...statuses, Math.min(100_000, Math.max(1, Math.trunc(limit)))).map(mapRunRow);
  }

  /** 列出 Run（可按作品过滤，按创建时间倒序，limit 默认 100 上限 1000）。 */
  listRuns(options: { bookId?: string; limit?: number } = {}) {
    const limit = Math.min(1_000, Math.max(1, Math.trunc(options.limit ?? 100)));
    if (options.bookId) {
      return this.runtimeDatabase.database.prepare(
        "SELECT * FROM runs WHERE book_id = ? ORDER BY created_at DESC LIMIT ?"
      ).all(options.bookId, limit).map(mapRunRow);
    }
    return this.runtimeDatabase.database.prepare(
      "SELECT * FROM runs ORDER BY created_at DESC LIMIT ?"
    ).all(limit).map(mapRunRow);
  }

  /** 列出该 Run 的全部模型尝试（Token/耗时/成本审计），按开始时间排序。 */
  listModelAttempts(runId: string) {
    if (!readRunRow(this.runtimeDatabase.database, runId)) {
      throw notFound("运行记录不存在", { runId });
    }
    return this.runtimeDatabase.database.prepare(
      "SELECT * FROM model_attempts WHERE run_id = ? ORDER BY started_at, rowid"
    ).all(runId).map(mapModelAttemptRow);
  }

  /**
   * 保存内联 JSON 工件（阶段产物，支持检查点恢复复用）。
   * 入参：artifactType——类型键；value——结构化数据。
   * 返回值：工件记录（含内容哈希与字节数）。
   */
  saveInlineArtifact(runId: string, input: {
    id?: string;
    artifactType: string;
    mimeType?: string;
    value: unknown;
    createdAt?: string;
  }): RunArtifactRecord {
    const id = input.id ?? randomUUID();
    const createdAt = input.createdAt ?? new Date().toISOString();
    const serialized = stringifyJson(input.value);
    const record: RunArtifactRecord = {
      id,
      runId,
      artifactType: input.artifactType,
      mimeType: input.mimeType ?? "application/json",
      storageKind: "inline_json",
      inlineJson: input.value ?? null,
      filePath: null,
      contentHash: sha256(serialized),
      byteSize: Buffer.byteLength(serialized, "utf8"),
      createdAt
    };

    this.runtimeDatabase.transaction((database) => {
      if (!readRunRow(database, runId)) throw notFound("运行记录不存在", { runId });
      database.prepare(`
        INSERT INTO run_artifacts (
          id, run_id, artifact_type, mime_type, storage_kind, inline_json,
          file_path, content_hash, byte_size, created_at
        ) VALUES (?, ?, ?, ?, 'inline_json', ?, NULL, ?, ?, ?)
      `).run(
        record.id,
        record.runId,
        record.artifactType,
        record.mimeType,
        serialized,
        record.contentHash,
        record.byteSize,
        record.createdAt
      );
    });
    return record;
  }

  /** 读取指定类型的最新内联工件；无记录返回 null（检查点恢复的读取端）。 */
  getLatestInlineArtifact(runId: string, artifactType: string): RunArtifactRecord | null {
    if (!readRunRow(this.runtimeDatabase.database, runId)) {
      throw notFound("运行记录不存在", { runId });
    }
    const row = this.runtimeDatabase.database.prepare(`
      SELECT * FROM run_artifacts
      WHERE run_id = ? AND artifact_type = ? AND storage_kind = 'inline_json'
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    `).get(runId, artifactType) as Record<string, unknown> | undefined;
    return row ? mapArtifactRow(row) : null;
  }

  /**
   * 保存检查点：追加 checkpoint_saved 事件并写入 run_checkpoints（同一事务）。
   * 入参：stage——阶段名；checkpoint——恢复数据；resumable——是否允许中断后恢复。
   */
  saveCheckpoint(runId: string, input: {
    id?: string;
    stage: string;
    checkpoint: unknown;
    resumable: boolean;
    createdAt?: string;
  }) {
    const id = input.id ?? randomUUID();
    const createdAt = input.createdAt ?? new Date().toISOString();
    const result = this.runtimeDatabase.transaction((database) => {
      const event = appendEventInTransaction(database, runId, {
        type: "checkpoint_saved",
        stage: input.stage,
        timestamp: createdAt,
        payload: { checkpointId: id, resumable: input.resumable },
        artifactRefs: []
      });
      database.prepare(`
        INSERT INTO run_checkpoints (
          id, run_id, event_seq, stage, checkpoint_json, resumable, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, runId, event.event.seq, input.stage, stringifyJson(input.checkpoint), input.resumable ? 1 : 0, createdAt);
      const checkpoint: RunCheckpointRecord = {
        id,
        runId,
        eventSeq: event.event.seq,
        stage: input.stage,
        checkpoint: input.checkpoint,
        resumable: input.resumable,
        createdAt
      };
      return { event, checkpoint };
    });
    if (result.event.inserted) this.eventHub?.publish(result.event.event);
    return result.checkpoint;
  }

  /**
   * 登记一次模型尝试（running 状态），并追加 model_attempt_started 事件。
   * 入参：runId 与尝试元信息（阶段、用途、模型、轮次）。
   * 返回值：attempt 记录（含 id，供 finishModelAttempt 收尾）。
   */
  startModelAttempt(runId: string, input: {
    id?: string;
    stage?: string | null;
    purpose: string;
    modelConfigId?: string | null;
    provider?: string | null;
    model?: string | null;
    attemptNumber: number;
    requestHash?: string | null;
    startedAt?: string;
  }) {
    const id = input.id ?? randomUUID();
    const startedAt = input.startedAt ?? new Date().toISOString();
    const result = this.runtimeDatabase.transaction((database) => {
      if (!readRunRow(database, runId)) throw notFound("运行记录不存在", { runId });
      database.prepare(`
        INSERT INTO model_attempts (
          id, run_id, stage, purpose, model_config_id, provider, model, attempt_number,
          status, request_hash, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)
      `).run(
        id,
        runId,
        input.stage ?? null,
        input.purpose,
        input.modelConfigId ?? null,
        input.provider ?? null,
        input.model ?? null,
        input.attemptNumber,
        input.requestHash ?? null,
        startedAt
      );
      const event = appendEventInTransaction(database, runId, {
        type: "model_attempt_started",
        stage: input.stage ?? null,
        timestamp: startedAt,
        payload: { attemptId: id, purpose: input.purpose, attemptNumber: input.attemptNumber }
      });
      return { event, attempt: readModelAttempt(database, id)! };
    });
    if (result.event.inserted) this.eventHub?.publish(result.event.event);
    return result.attempt;
  }

  /**
   * 结束模型尝试：写入终态（成功/失败/超时/取消）与 Token/耗时/成本，追加完成事件。
   * 入参：attemptId——startModelAttempt 返回的 id；input——终态与审计字段。
   */
  finishModelAttempt(attemptId: string, input: {
    status: Exclude<ModelAttempt["status"], "running">;
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    estimatedCostMicros?: number | null;
    costCurrency?: string | null;
    latencyMs?: number | null;
    error?: unknown | null;
    finishedAt?: string;
  }) {
    const finishedAt = input.finishedAt ?? new Date().toISOString();
    const result = this.runtimeDatabase.transaction((database) => {
      const current = readModelAttempt(database, attemptId);
      if (!current) throw notFound("模型尝试记录不存在", { attemptId });
      if (current.status !== "running") return { event: null, attempt: current };

      database.prepare(`
        UPDATE model_attempts SET
          status = ?, prompt_tokens = ?, completion_tokens = ?, total_tokens = ?,
          estimated_cost_micros = ?, cost_currency = ?, latency_ms = ?, error_json = ?, finished_at = ?
        WHERE id = ?
      `).run(
        input.status,
        input.promptTokens ?? null,
        input.completionTokens ?? null,
        input.totalTokens ?? null,
        input.estimatedCostMicros ?? null,
        input.costCurrency ?? null,
        input.latencyMs ?? null,
        input.error === undefined || input.error === null ? null : stringifyJson(input.error),
        finishedAt,
        attemptId
      );
      const event = appendEventInTransaction(database, current.runId, {
        type: "model_attempt_completed",
        stage: current.stage,
        timestamp: finishedAt,
        payload: {
          attemptId,
          status: input.status,
          promptTokens: input.promptTokens ?? null,
          completionTokens: input.completionTokens ?? null,
          totalTokens: input.totalTokens ?? null,
          estimatedCostMicros: input.estimatedCostMicros ?? null,
          costCurrency: input.costCurrency ?? null,
          latencyMs: input.latencyMs ?? null,
          error: input.error ?? null
        }
      });
      return { event, attempt: readModelAttempt(database, attemptId)! };
    });
    if (result.event?.inserted) this.eventHub?.publish(result.event.event);
    return result.attempt;
  }
}

function appendEventInTransaction(database: DatabaseSync, runId: string, input: AppendRunEventInput): StoredEventResult {
  if (input.eventId) {
    const existing = database.prepare(`
      SELECT run_id, seq, event_id, event_type, stage, timestamp, payload_json, artifact_refs_json
      FROM run_events WHERE event_id = ?
    `).get(input.eventId);
    if (existing) {
      if (existing.run_id !== runId) {
        throw conflict("事件 ID 已被其他运行占用", { eventId: input.eventId });
      }
      return { event: mapEventRow(existing), inserted: false };
    }
  }

  const row = readRunRow(database, runId);
  if (!row) throw notFound("运行记录不存在", { runId });

  const seq = Number(row.last_event_seq) + 1;
  const event = runEventSchema.parse({
    schemaVersion: "run-event.v1",
    runId,
    seq,
    eventId: input.eventId ?? randomUUID(),
    type: input.type,
    stage: input.stage ?? null,
    timestamp: input.timestamp ?? new Date().toISOString(),
    payload: input.payload ?? {},
    artifactRefs: input.artifactRefs ?? []
  });

  assertTransition(row, event);
  const projection = projectEvent(row, event);
  database.prepare(`
    INSERT INTO run_events (
      run_id, seq, event_id, event_type, stage, timestamp, payload_json, artifact_refs_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.runId,
    event.seq,
    event.eventId,
    event.type,
    event.stage,
    event.timestamp,
    stringifyJson(event.payload),
    stringifyJson(event.artifactRefs)
  );
  database.prepare(`
    UPDATE runs SET
      status = ?, current_stage = ?, output_json = ?, error_json = ?, cancel_requested_at = ?,
      queued_at = ?, started_at = ?, finished_at = ?, last_event_seq = ?, updated_at = ?
    WHERE id = ?
  `).run(
    projection.status,
    projection.currentStage,
    projection.output === null ? null : stringifyJson(projection.output),
    projection.error === null ? null : stringifyJson(projection.error),
    projection.cancelRequestedAt,
    projection.queuedAt,
    projection.startedAt,
    projection.finishedAt,
    event.seq,
    event.timestamp,
    runId
  );

  return { event, inserted: true };
}

function assertTransition(row: Record<string, unknown>, event: RunEvent) {
  const status = String(row.status) as RunSnapshot["status"];
  const lastEventSeq = Number(row.last_event_seq);

  if (event.type === "run_created") {
    if (lastEventSeq !== -1) throw conflict("run_created 只能是首个事件", { runId: event.runId });
    return;
  }
  if (event.type === "run_queued") {
    if (status !== "queued" && status !== "interrupted" && status !== "failed" && status !== "cancelled") {
      throw conflict("当前状态不能进入队列", { runId: event.runId, status });
    }
    return;
  }
  if (event.type === "run_started") {
    if (status !== "queued") throw conflict("只有排队中的运行可以启动", { runId: event.runId, status });
    return;
  }
  if (event.type === "stage_started") {
    if (status !== "running" || !event.stage) {
      throw conflict("阶段启动事件要求运行中状态和非空 stage", { runId: event.runId, status });
    }
    return;
  }
  if (event.type === "stage_completed") {
    if ((status !== "running" && status !== "cancelling") || !event.stage) {
      throw conflict("阶段完成事件要求运行中状态和非空 stage", { runId: event.runId, status });
    }
    return;
  }
  if (inFlightEventTypes.has(event.type)) {
    if (status !== "running" && status !== "cancelling") {
      throw conflict("当前状态不能追加执行中事件", { runId: event.runId, status, eventType: event.type });
    }
    return;
  }
  if (event.type === "cancel_requested") {
    if (status !== "queued" && status !== "running") {
      throw conflict("当前状态不能请求取消", { runId: event.runId, status });
    }
    return;
  }
  if (event.type === "run_completed") {
    if (status !== "running" && status !== "cancelling") {
      throw conflict("只有运行中的任务可以完成，或任务已经提交不可逆结果", { runId: event.runId, status });
    }
    return;
  }
  if (["run_cancelled", "run_failed", "run_interrupted"].includes(event.type)) {
    if (!new Set(["queued", "running", "cancelling"]).has(status)) {
      throw conflict("当前状态不能进入终态", { runId: event.runId, status, eventType: event.type });
    }
    return;
  }

  throw conflict("不支持的 Run 事件转换", { runId: event.runId, status, eventType: event.type });
}

function projectEvent(row: Record<string, unknown>, event: RunEvent): RunProjection {
  const projection: RunProjection = {
    status: String(row.status) as RunSnapshot["status"],
    currentStage: nullableString(row.current_stage),
    output: parseNullableJson(row.output_json),
    error: parseNullableJson(row.error_json),
    cancelRequestedAt: nullableString(row.cancel_requested_at),
    queuedAt: nullableString(row.queued_at),
    startedAt: nullableString(row.started_at),
    finishedAt: nullableString(row.finished_at)
  };

  switch (event.type) {
    case "run_queued":
      projection.status = "queued";
      projection.queuedAt = event.timestamp;
      projection.finishedAt = null;
      projection.error = null;
      projection.cancelRequestedAt = null;
      projection.currentStage = null;
      break;
    case "run_started":
      projection.status = "running";
      projection.startedAt = event.timestamp;
      break;
    case "stage_started":
      projection.currentStage = event.stage;
      break;
    case "stage_completed":
      if (projection.currentStage === event.stage) projection.currentStage = null;
      break;
    case "cancel_requested":
      projection.status = "cancelling";
      projection.cancelRequestedAt = event.timestamp;
      break;
    case "run_completed":
      projection.status = "completed";
      projection.output = event.payload.output ?? null;
      projection.finishedAt = event.timestamp;
      projection.currentStage = null;
      break;
    case "run_failed":
      projection.status = "failed";
      projection.error = event.payload.error ?? event.payload;
      projection.finishedAt = event.timestamp;
      projection.currentStage = null;
      break;
    case "run_cancelled":
      projection.status = "cancelled";
      projection.finishedAt = event.timestamp;
      projection.currentStage = null;
      break;
    case "run_interrupted":
      projection.status = "interrupted";
      projection.error = event.payload.reason ?? event.payload;
      projection.finishedAt = event.timestamp;
      projection.currentStage = null;
      break;
  }

  return projection;
}

function readRunRow(database: DatabaseSync, runId: string) {
  return database.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
}

function mapArtifactRow(row: Record<string, unknown>): RunArtifactRecord {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    artifactType: String(row.artifact_type),
    mimeType: String(row.mime_type),
    storageKind: String(row.storage_kind) as RunArtifactRecord["storageKind"],
    inlineJson: parseNullableJson(row.inline_json),
    filePath: nullableString(row.file_path),
    contentHash: String(row.content_hash),
    byteSize: Number(row.byte_size),
    createdAt: String(row.created_at)
  };
}

function mapRunRow(row: Record<string, unknown>) {
  return runSnapshotSchema.parse({
    schemaVersion: "run-snapshot.v1",
    id: String(row.id),
    command: parseJson(row.command_json),
    bookId: nullableString(row.book_id),
    chapterId: nullableString(row.chapter_id),
    parentRunId: nullableString(row.parent_run_id),
    rootRunId: String(row.root_run_id),
    sessionId: nullableString(row.session_id),
    triggerMessageId: nullableString(row.trigger_message_id),
    status: row.status,
    currentStage: nullableString(row.current_stage),
    configRevision: row.config_revision === null ? null : Number(row.config_revision),
    configHash: nullableString(row.config_hash),
    output: parseNullableJson(row.output_json),
    error: parseNullableJson(row.error_json),
    cancelRequestedAt: nullableString(row.cancel_requested_at),
    lastEventSeq: Number(row.last_event_seq),
    createdAt: String(row.created_at),
    queuedAt: nullableString(row.queued_at),
    startedAt: nullableString(row.started_at),
    finishedAt: nullableString(row.finished_at),
    updatedAt: String(row.updated_at)
  });
}

function mapEventRow(row: Record<string, unknown>) {
  return runEventSchema.parse({
    schemaVersion: "run-event.v1",
    runId: String(row.run_id),
    seq: Number(row.seq),
    eventId: String(row.event_id),
    type: row.event_type,
    stage: nullableString(row.stage),
    timestamp: String(row.timestamp),
    payload: parseJson(row.payload_json),
    artifactRefs: parseJson(row.artifact_refs_json)
  });
}

function readModelAttempt(database: DatabaseSync, attemptId: string): ModelAttempt | null {
  const row = database.prepare("SELECT * FROM model_attempts WHERE id = ?").get(attemptId);
  return row ? mapModelAttemptRow(row) : null;
}

function mapModelAttemptRow(row: Record<string, unknown>): ModelAttempt {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    stage: nullableString(row.stage),
    purpose: String(row.purpose),
    modelConfigId: nullableString(row.model_config_id),
    provider: nullableString(row.provider),
    model: nullableString(row.model),
    attemptNumber: Number(row.attempt_number),
    status: String(row.status) as ModelAttempt["status"],
    requestHash: nullableString(row.request_hash),
    promptTokens: nullableNumber(row.prompt_tokens),
    completionTokens: nullableNumber(row.completion_tokens),
    totalTokens: nullableNumber(row.total_tokens),
    estimatedCostMicros: nullableNumber(row.estimated_cost_micros),
    costCurrency: nullableString(row.cost_currency),
    latencyMs: nullableNumber(row.latency_ms),
    error: parseNullableJson(row.error_json),
    startedAt: String(row.started_at),
    finishedAt: nullableString(row.finished_at)
  };
}

function stringifyJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function parseJson(value: unknown) {
  if (typeof value !== "string") throw new Error("SQLite JSON 字段类型无效");
  return JSON.parse(value) as unknown;
}

function parseNullableJson(value: unknown) {
  return value === null || value === undefined ? null : parseJson(value);
}

function nullableString(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}

function nullableNumber(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}

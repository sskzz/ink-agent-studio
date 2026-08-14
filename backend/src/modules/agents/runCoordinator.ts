import { runCommandSchema, type EffectiveConfigResponse, type RunCommand } from "@ink-agent/contracts";
import { conflict } from "../../utils/errors.js";
import type { ConfigService } from "../../config/configService.js";
import type { RunEventStore } from "./runEventStore.js";
import {
  runWithModelExecutionContext,
  setActiveModelExecutionStage
} from "../ai/modelExecutionContext.js";
import { ConfigRepository } from "../../config/configRepository.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { withStoryStateEvents } from "../books/storyStateEventRepository.js";
import { enqueueNextChapterStateObservation } from "../books/chapterService.js";

export interface RunExecutionContext {
  runId: string;
  command: RunCommand;
  signal: AbortSignal;
  setStage(stage: string): void;
  emitProgress(payload: Record<string, unknown>): void;
  emitDelta(delta: string): void;
  saveArtifact(artifactType: string, value: unknown): { id: string; contentHash: string };
  loadArtifact(artifactType: string): { id: string; contentHash: string; value: unknown } | null;
  saveCheckpoint(stage: string, checkpoint: unknown, resumable?: boolean): { id: string };
  /** 把非网关或多段模型用量写入可审计 Artifact；实际调用仍由 model_attempts 记录。 */
  addTokenUsage?(key: string, value: unknown): void;
  /** 保存管线级 trace 增量，避免扩大 runs 表结构。 */
  mergeTrace?(value: Record<string, unknown>): void;
  /** Marks an irreversible workflow commit so a later cancellation request cannot misreport committed data as cancelled. */
  markCommitted?(): void;
}

export type RunCommandHandler = (context: RunExecutionContext) => Promise<unknown>;

interface ConfigProvider {
  getEffective(): Promise<EffectiveConfigResponse>;
}

interface QueuedRun {
  runId: string;
  command: RunCommand;
}

interface ActiveRun extends QueuedRun {
  controller: AbortController;
  promise: Promise<void>;
}

const requiredWorkflowTypes = new Set<RunCommand["type"]>([
  "initialize_book",
  "generate_story_plan_batch"
]);

/**
 * 进程内协调器管理有界队列和 AbortController，持久状态全部写入 RunEventStore。服务重启后
 * 内存队列不会伪装成仍在运行，recoverInterruptedRuns 会先将遗留任务标为 interrupted。
 */
export class RunCoordinator {
  private readonly queue: QueuedRun[] = [];
  private readonly active = new Map<string, ActiveRun>();
  private readonly pausedRuns = new Set<string>();
  private readonly resumedRuns = new Set<string>();
  private pumpScheduled = false;
  private shuttingDown = false;

  constructor(
    private readonly configProvider: ConfigProvider,
    private readonly eventStore: RunEventStore,
  private handlers: Partial<Record<RunCommand["type"], RunCommandHandler>>
  ) {}

  setHandlers(handlers: Partial<Record<RunCommand["type"], RunCommandHandler>>) {
    this.handlers = handlers;
  }

  async enqueue(
    commandInput: RunCommand,
    parentRunId: string | null = null,
    session: { sessionId?: string | null; triggerMessageId?: string | null } = {}
  ) {
    return this.enqueueCommand(commandInput, parentRunId, session, false);
  }

  /** Required product workflows can use the durable Run queue even while the public async-run switch is disabled. */
  async enqueueSystem(
    commandInput: RunCommand,
    session: { sessionId?: string | null; triggerMessageId?: string | null } = {}
  ) {
    return this.enqueueCommand(commandInput, null, session, true);
  }

  private async enqueueCommand(
    commandInput: RunCommand,
    parentRunId: string | null,
    session: { sessionId?: string | null; triggerMessageId?: string | null },
    requiredWorkflow: boolean
  ) {
    if (this.shuttingDown) throw conflict("后端正在关闭，不能创建新运行");
    const command = runCommandSchema.parse(commandInput);
    const effective = await this.configProvider.getEffective();
    if (!requiredWorkflow && !effective.effectiveConfig.features.asyncRuns) {
      throw conflict("异步 Run 功能尚未启用", { setting: "features.asyncRuns" });
    }
    this.assertQueueCapacity(effective);

    const snapshot = this.eventStore.createRun({
      command,
      parentRunId,
      sessionId: session.sessionId ?? null,
      triggerMessageId: session.triggerMessageId ?? null,
      configRevision: effective.revision,
      configHash: effective.configHash
    });
    this.queue.push({ runId: snapshot.id, command });
    this.schedulePump();
    return snapshot;
  }

  async resume(runId: string) {
    return this.resumePersistedRun(runId, false);
  }

  /** 显式重试失败/取消/中断的普通 Run，并复用同一 Run 下的 Artifact 与检查点。 */
  async retry(runId: string) {
    return this.resumePersistedRun(runId, false, true);
  }

  /** Required product workflows may retry a failed durable run and reuse its validated stage artifacts. */
  async resumeSystem(runId: string) {
    return this.resumePersistedRun(runId, true);
  }

  private async resumePersistedRun(runId: string, requiredWorkflow: boolean, retry = false) {
    if (this.shuttingDown) throw conflict("后端正在关闭，不能恢复运行");
    const effective = await this.configProvider.getEffective();
    if (!requiredWorkflow && !effective.effectiveConfig.features.asyncRuns) {
      throw conflict("异步 Run 功能尚未启用", { setting: "features.asyncRuns" });
    }
    this.assertQueueCapacity(effective);
    const snapshot = this.eventStore.getRun(runId);
    const allowedStatuses = requiredWorkflow || retry ? ["interrupted", "failed", "cancelled"] : ["interrupted"];
    if (!allowedStatuses.includes(snapshot.status)) {
      throw conflict(requiredWorkflow || retry ? "只有 interrupted、failed 或 cancelled 运行可以重试" : "只有 interrupted 运行可以恢复", {
        runId,
        status: snapshot.status
      });
    }
    const command = runCommandSchema.safeParse(snapshot.command);
    if (!command.success) {
      throw conflict("旧版导入运行不能自动恢复", { runId });
    }
    if (requiredWorkflow && !requiredWorkflowTypes.has(command.data.type)) {
      throw conflict("该运行不属于可自动恢复的系统工作流", { runId, commandType: command.data.type });
    }

    this.eventStore.appendEvent(runId, { type: "run_queued", payload: { resumed: true, fromStatus: snapshot.status } });
    this.queue.push({ runId, command: command.data });
    this.resumedRuns.add(runId);
    this.schedulePump();
    return this.eventStore.getRun(runId);
  }

  cancel(runId: string) {
    const snapshot = this.eventStore.getRun(runId);
    if (["cancelled", "completed", "failed", "interrupted"].includes(snapshot.status)) return snapshot;
    if (snapshot.status === "cancelling") return snapshot;

    this.eventStore.appendEvent(runId, { type: "cancel_requested", payload: {} });
    const queueIndex = this.queue.findIndex((item) => item.runId === runId);
    if (queueIndex >= 0) {
      this.queue.splice(queueIndex, 1);
      return this.eventStore.appendEvent(runId, { type: "run_cancelled", payload: { beforeStart: true } }).snapshot;
    }

    this.active.get(runId)?.controller.abort(new Error("用户取消运行"));
    return this.eventStore.getRun(runId);
  }

  /**
   * 暂停运行：中止正在进行的模型调用，并把 Run 标记为可恢复的 interrupted，
   * 后续可通过 resume/resumeSystem 从最近检查点继续执行。
   */
  pause(runId: string) {
    const snapshot = this.eventStore.getRun(runId);
    if (["cancelled", "completed", "failed", "interrupted", "cancelling"].includes(snapshot.status)) {
      return snapshot;
    }

    const queueIndex = this.queue.findIndex((item) => item.runId === runId);
    if (queueIndex >= 0) {
      this.queue.splice(queueIndex, 1);
      return this.eventStore.appendEvent(runId, {
        type: "run_interrupted",
        payload: { reason: "用户暂停执行（任务尚未开始）", recoverable: true, paused: true }
      }).snapshot;
    }

    this.pausedRuns.add(runId);
    this.active.get(runId)?.controller.abort(new Error("用户暂停执行"));
    return this.eventStore.getRun(runId);
  }

  recoverInterruptedRuns() {
    const unfinished = this.eventStore.listRunsByStatus(["queued", "running", "cancelling"]);
    for (const run of unfinished) {
      this.eventStore.appendEvent(run.id, {
        type: "run_interrupted",
        payload: { reason: "后端进程重启，内存执行上下文已丢失", recoverable: run.command.type !== "legacy_import" }
      });
    }
    return unfinished.length;
  }

  async recoverAndResumeRequiredWorkflows() {
    const unfinished = this.eventStore.listRunsByStatus(["queued", "running", "cancelling"]);
    const resumable = unfinished.filter((run) => requiredWorkflowTypes.has(run.command.type as RunCommand["type"]));
    const interrupted = this.recoverInterruptedRuns();
    const resumedRunIds: string[] = [];
    const failures: Array<{ runId: string; error: ReturnType<typeof serializeError> }> = [];

    for (const run of resumable) {
      try {
        await this.resumeSystem(run.id);
        resumedRunIds.push(run.id);
      } catch (error) {
        failures.push({ runId: run.id, error: serializeError(error) });
      }
    }

    return { interrupted, resumedRunIds, failures };
  }

  /** 重启后从持久化 outbox 恢复章节状态观察任务，保证正文保存与状态物化最终一致。 */
  async recoverChapterStateObservations(paths: WorkspacePaths) {
    const config = await new ConfigRepository(paths).readOrCreate();
    const pending = await withStoryStateEvents(paths, config, (events) => {
      events.resetRecoverableObservations();
      return events.listRecoverableObservations();
    });
    const resumedRunIds: string[] = [];
    const failures: Array<{ bookId: string; chapterId: string; error: ReturnType<typeof serializeError> }> = [];
    const firstByBook = new Map<string, typeof pending[number]>();
    for (const item of pending) if (!firstByBook.has(item.bookId)) firstByBook.set(item.bookId, item);
    for (const item of firstByBook.values()) {
      try {
        const run = await enqueueNextChapterStateObservation(paths, this, item.bookId);
        if (run) resumedRunIds.push(run.runId);
      } catch (error) {
        failures.push({ bookId: item.bookId, chapterId: item.chapterId, error: serializeError(error) });
      }
    }
    return { resumedRunIds, failures };
  }

  async shutdown(graceMs: number) {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    for (const queued of this.queue.splice(0)) {
      const snapshot = this.eventStore.getRun(queued.runId);
      if (snapshot.status === "queued") {
        this.eventStore.appendEvent(queued.runId, {
          type: "run_interrupted",
          payload: { reason: "后端关闭前任务尚未开始", recoverable: true }
        });
      }
    }
    for (const active of this.active.values()) {
      active.controller.abort(new Error("后端正在关闭"));
    }

    const pending = [...this.active.values()].map((item) => item.promise);
    if (pending.length === 0) return;
    await Promise.race([
      Promise.allSettled(pending),
      new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, graceMs)))
    ]);

    for (const active of this.active.values()) {
      const snapshot = this.eventStore.getRun(active.runId);
      if (["running", "cancelling", "queued"].includes(snapshot.status)) {
        this.eventStore.appendEvent(active.runId, {
          type: "run_interrupted",
          payload: { reason: "后端关闭等待超时", recoverable: true }
        });
      }
    }
  }

  async waitForIdle() {
    while (this.queue.length > 0 || this.active.size > 0 || this.pumpScheduled) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
    }
  }

  private assertQueueCapacity(effective: EffectiveConfigResponse) {
    const pendingCount = this.queue.length + this.active.size;
    if (pendingCount >= effective.effectiveConfig.runtime.queueLimit) {
      throw conflict("Run 队列已满", {
        queueLimit: effective.effectiveConfig.runtime.queueLimit,
        pendingCount
      });
    }
  }

  private schedulePump() {
    if (this.pumpScheduled || this.shuttingDown) return;
    this.pumpScheduled = true;
    queueMicrotask(() => void this.pump());
  }

  private async pump() {
    try {
      if (this.shuttingDown) return;
      const effective = await this.configProvider.getEffective();
      const runtime = effective.effectiveConfig.runtime;

      while (this.active.size < runtime.globalConcurrency) {
        const index = this.queue.findIndex((item) => this.activeBookCount(item.command.bookId) < runtime.perBookMutationConcurrency);
        if (index < 0) break;
        const [queued] = this.queue.splice(index, 1);
        this.start(queued);
      }
    } finally {
      this.pumpScheduled = false;
    }
  }

  private start(queued: QueuedRun) {
    const controller = new AbortController();
    const active: ActiveRun = {
      ...queued,
      controller,
      promise: Promise.resolve()
    };
    this.active.set(queued.runId, active);
    active.promise = this.execute(active).finally(() => {
      this.active.delete(queued.runId);
      this.schedulePump();
    });
  }

  private async execute(active: ActiveRun) {
    let currentStage: string | null = null;
    let committed = false;
    this.pausedRuns.delete(active.runId);
    const completeCurrentStage = () => {
      if (!currentStage) return;
      this.eventStore.appendEvent(active.runId, { type: "stage_completed", stage: currentStage, payload: {} });
      currentStage = null;
    };

    try {
      this.eventStore.appendEvent(active.runId, { type: "run_started", payload: {} });
      const handler = this.handlers[active.command.type];
      if (!handler) throw new Error(`尚未注册 Run 命令处理器：${active.command.type}`);
      const effective = await this.configProvider.getEffective();
      const output = await runWithModelExecutionContext({
        runId: active.runId,
        stage: null,
        signal: active.controller.signal,
        eventStore: this.eventStore,
        modelPolicy: effective.effectiveConfig.models
      }, () => handler({
          runId: active.runId,
          command: active.command,
          signal: active.controller.signal,
          setStage: (stage) => {
            active.controller.signal.throwIfAborted();
            completeCurrentStage();
            this.eventStore.appendEvent(active.runId, { type: "stage_started", stage, payload: {} });
            currentStage = stage;
            setActiveModelExecutionStage(stage);
          },
          emitProgress: (payload) => {
            this.eventStore.appendEvent(active.runId, { type: "stage_progress", stage: currentStage, payload });
          },
          emitDelta: (delta) => {
            this.eventStore.appendEvent(active.runId, { type: "model_delta", stage: currentStage, payload: { delta } });
          },
          saveArtifact: (artifactType, value) => {
            const artifact = this.eventStore.saveInlineArtifact(active.runId, { artifactType, value });
            return { id: artifact.id, contentHash: artifact.contentHash };
          },
          loadArtifact: (artifactType) => {
            const artifact = this.eventStore.getLatestInlineArtifact(active.runId, artifactType);
            return artifact ? { id: artifact.id, contentHash: artifact.contentHash, value: artifact.inlineJson } : null;
          },
          saveCheckpoint: (stage, checkpoint, resumable = true) => {
            const saved = this.eventStore.saveCheckpoint(active.runId, { stage, checkpoint, resumable });
            return { id: saved.id };
          },
          addTokenUsage: (key, value) => {
            this.eventStore.saveInlineArtifact(active.runId, { artifactType: `token-usage.${key}.v1`, value });
          },
          mergeTrace: (value) => {
            const previous = this.eventStore.getLatestInlineArtifact(active.runId, "pipeline-trace.v1")?.inlineJson;
            this.eventStore.saveInlineArtifact(active.runId, {
              artifactType: "pipeline-trace.v1",
              value: { ...(previous && typeof previous === "object" ? previous : {}), ...value }
            });
          },
          markCommitted: () => {
            committed = true;
          }
        }));
      if (!committed) active.controller.signal.throwIfAborted();
      completeCurrentStage();
      this.eventStore.appendEvent(active.runId, {
        type: "run_completed",
        payload: { output, cancellationRequestedAfterCommit: committed && active.controller.signal.aborted }
      });
      // 断点续写会话清除：续写 run 经 resume 续跑并完成后，删除 model_delta 事件与检查点
      // （保留 run 快照与审计轨迹）。首跑完成保留（可审计，且初始化 run 的 model_delta 是前端实时输出数据源）。
      if (active.command.type === "continue_chapter" && this.resumedRuns.has(active.runId)) {
        this.resumedRuns.delete(active.runId);
        this.eventStore.pruneRunRecoveryData(active.runId);
      }
    } catch (error) {
      const snapshot = this.eventStore.getRun(active.runId);
      if (!["queued", "running", "cancelling"].includes(snapshot.status)) return;

      if (this.shuttingDown) {
        this.eventStore.appendEvent(active.runId, {
          type: "run_interrupted",
          payload: { reason: "后端关闭中断运行", recoverable: true }
        });
      } else if (this.pausedRuns.has(active.runId)) {
        this.pausedRuns.delete(active.runId);
        this.eventStore.appendEvent(active.runId, {
          type: "run_interrupted",
          payload: { reason: "用户暂停执行，可从检查点继续", recoverable: true, paused: true }
        });
      } else if (active.controller.signal.aborted) {
        this.eventStore.appendEvent(active.runId, {
          type: "run_cancelled",
          payload: { reason: "用户取消运行" }
        });
      } else {
        this.eventStore.appendEvent(active.runId, {
          type: "run_failed",
          stage: currentStage,
          payload: { error: serializeError(error) }
        });
      }
    }
  }

  private activeBookCount(bookId: string) {
    let count = 0;
    for (const active of this.active.values()) {
      if (active.command.bookId === bookId) count += 1;
    }
    return count;
  }
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "Error", message: String(error) };
}

export type RunCoordinatorConfigProvider = Pick<ConfigService, "getEffective">;

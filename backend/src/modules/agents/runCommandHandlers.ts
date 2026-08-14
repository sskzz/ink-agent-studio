import type { RunCommand } from "@ink-agent/contracts";
import { polishChapter, reviewChapter } from "../review/reviewService.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { initializeBookWithAi } from "./bookInitializationService.js";
import type { RunExecutionContext, RunCommandHandler } from "./runCoordinator.js";
import { chapterAiTaskInputSchema } from "../../schemas/chapterSchemas.js";
import {
  markChapterObservationFailed,
  observeSavedChapter,
  prepareChapterRunInput,
  runChapterPipeline
} from "../books/chapterService.js";
import { consistencyCheck } from "../review/reviewService.js";
import type { RunCoordinator } from "./runCoordinator.js";
import { enqueueNextChapterStateObservation } from "../books/chapterService.js";
import { generateStoryPlanBatch } from "../books/storyPlanService.js";

/**
 * Run 命令处理器注册表（文件职责）。
 * V2 运行器对现有同步业务服务的兼容适配层：章节审稿/润色/一致性仍复用已验证逻辑；
 * 作品初始化与章节续写为 V2 原生实现，直接透传执行上下文——
 * 续写通过 run_artifacts 落阶段检查点（断点续写跳过已完成阶段）、
 * emitDelta 桥接 SSE model_delta（前端实时显示生成正文）。
 * 每个处理器先校验命令类型与中止信号，避免对已取消的运行继续发起模型调用。
 */
export function createRunCommandHandlers(paths: WorkspacePaths, runCoordinator?: RunCoordinator): Record<RunCommand["type"], RunCommandHandler> {
  return {
    async continue_chapter(context) {
      const command = narrowCommand(context, "continue_chapter");
      context.setStage("load_context");
      context.signal.throwIfAborted();
      // 共享续写管线：意图→场景→生成→审稿→修订；检查点产物随本 Run 落盘，resume 时自动跳过已完成阶段
      const input = chapterAiTaskInputSchema.parse(command.input);
      const prepared = await prepareChapterRunInput(paths, command.bookId, command.chapterId, input);
      return runChapterPipeline(paths, prepared, {
        signal: context.signal,
        setStage: (stage) => context.setStage(stage),
        streamDeltas: true,
        emitDelta: (delta) => context.emitDelta(delta),
        saveArtifact: (artifactType, value) => context.saveArtifact(artifactType, value),
        loadArtifact: (artifactType) => context.loadArtifact(artifactType),
        addTokenUsage: (key, value) => context.addTokenUsage?.(key, value),
        mergeTrace: (value) => context.mergeTrace?.(value)
      });
    },
    async observe_chapter(context) {
      const command = narrowCommand(context, "observe_chapter");
      context.signal.throwIfAborted();
      let result: Awaited<ReturnType<typeof observeSavedChapter>>;
      try {
        result = await observeSavedChapter(paths, command.bookId, command.chapterId, {
          setStage: (stage) => context.setStage(stage),
          markCommitted: () => context.markCommitted?.(),
          sourceRunId: command.input.sourceRunId,
          expectedRevision: command.input.chapterRevision,
          expectedContentHash: command.input.contentHash,
          expectedObservationRunId: context.runId
        });
      } catch (error) {
        await markChapterObservationFailed(
          paths,
          command.bookId,
          command.chapterId,
          error,
          command.input.chapterRevision,
          command.input.contentHash,
          context.runId
        ).catch(() => undefined);
        throw error;
      }
      if (runCoordinator) {
        await enqueueNextChapterStateObservation(paths, runCoordinator, command.bookId).catch(() => undefined);
      }
      return result;
    },
    async review_chapter(context) {
      const command = narrowCommand(context, "review_chapter");
      context.setStage("review_chapter");
      context.signal.throwIfAborted();
      return unwrapLegacyRun(await reviewChapter(paths, command.bookId, command.chapterId, command.input));
    },
    async polish_chapter(context) {
      const command = narrowCommand(context, "polish_chapter");
      context.setStage("polish_chapter");
      context.signal.throwIfAborted();
      return unwrapLegacyRun(await polishChapter(paths, command.bookId, command.chapterId, command.input));
    },
    async consistency_check(context) {
      const command = narrowCommand(context, "consistency_check");
      context.setStage("consistency_check");
      context.signal.throwIfAborted();
      return unwrapLegacyRun(await consistencyCheck(paths, command.bookId, command.input));
    },
    async initialize_book(context) {
      // 作品初始化是 V2 原生实现，直接透传执行上下文（含检查点恢复能力）
      narrowCommand(context, "initialize_book");
      context.signal.throwIfAborted();
      return initializeBookWithAi(paths, context);
    },
    async generate_story_plan_batch(context) {
      const command = narrowCommand(context, "generate_story_plan_batch");
      context.signal.throwIfAborted();
      return generateStoryPlanBatch(paths, command.bookId, command.input.batchNo, {
        signal: context.signal,
        setStage: (stage) => context.setStage(stage),
        emitProgress: (payload) => context.emitProgress(payload),
        saveArtifact: (artifactType, value) => context.saveArtifact(artifactType, value),
        loadArtifact: (artifactType) => context.loadArtifact(artifactType),
        saveCheckpoint: (stage, checkpoint, resumable) => context.saveCheckpoint(stage, checkpoint, resumable),
        markCommitted: () => context.markCommitted?.()
      });
    }
  };
}

/**
 * 命令类型收窄：运行时校验命令类型与处理器匹配，返回窄化后的命令对象。
 * 业务原因：错误命令类型属于内部编程错误，立即抛错避免误执行其他作品的逻辑。
 */
function narrowCommand<T extends RunCommand["type"]>(context: RunExecutionContext, type: T) {
  if (context.command.type !== type) throw new Error(`Run 命令处理器不匹配：期望 ${type}`);
  return context.command as Extract<RunCommand, { type: T }>;
}

/**
 * 兼容旧服务返回值：旧业务服务返回带 outputJson 的 Run 快照，这里只取出正文输出。
 * 避免把整份审计快照当作命令输出写入新 Run。
 */
function unwrapLegacyRun(value: unknown) {
  if (typeof value === "object" && value !== null && "outputJson" in value) {
    return (value as { outputJson: unknown }).outputJson;
  }
  return value;
}

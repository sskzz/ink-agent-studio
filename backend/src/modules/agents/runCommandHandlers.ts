import type { RunCommand } from "@ink-agent/contracts";
import { continueChapter } from "../books/chapterService.js";
import { consistencyCheck, polishChapter, reviewChapter } from "../review/reviewService.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { initializeBookWithAi } from "./bookInitializationService.js";
import type { RunExecutionContext, RunCommandHandler } from "./runCoordinator.js";

/**
 * V2 运行器对现有同步业务服务的兼容适配层。章节生成和审稿仍复用已验证逻辑，但输出只作为
 * Run 草稿保存；作品初始化通过分阶段规划模型生成和自动 Bundle 写入完成。
 */
export function createRunCommandHandlers(paths: WorkspacePaths): Record<RunCommand["type"], RunCommandHandler> {
  return {
    async continue_chapter(context) {
      const command = narrowCommand(context, "continue_chapter");
      context.setStage("continue_chapter");
      context.signal.throwIfAborted();
      return unwrapLegacyRun(await continueChapter(paths, command.bookId, command.chapterId, command.input));
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
      narrowCommand(context, "initialize_book");
      context.signal.throwIfAborted();
      return initializeBookWithAi(paths, context);
    }
  };
}

function narrowCommand<T extends RunCommand["type"]>(context: RunExecutionContext, type: T) {
  if (context.command.type !== type) throw new Error(`Run 命令处理器不匹配：期望 ${type}`);
  return context.command as Extract<RunCommand, { type: T }>;
}

function unwrapLegacyRun(value: unknown) {
  if (typeof value === "object" && value !== null && "outputJson" in value) {
    return (value as { outputJson: unknown }).outputJson;
  }
  return value;
}

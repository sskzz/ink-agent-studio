import type { RunCommand } from "@ink-agent/contracts";
import { continueChapter } from "../books/chapterService.js";
import { consistencyCheck, polishChapter, reviewChapter } from "../review/reviewService.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { initializeBookWithAi } from "./bookInitializationService.js";
import type { RunExecutionContext, RunCommandHandler } from "./runCoordinator.js";

/**
 * Run 命令处理器注册表（文件职责）。
 * V2 运行器对现有同步业务服务的兼容适配层：章节生成和审稿仍复用已验证逻辑，但输出只作为
 * Run 草稿保存；作品初始化通过分阶段规划模型生成和自动 Bundle 写入完成。
 * 每个处理器先校验命令类型与中止信号，避免对已取消的运行继续发起模型调用。
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
      // 作品初始化是 V2 原生实现，直接透传执行上下文（含检查点恢复能力）。
      narrowCommand(context, "initialize_book");
      context.signal.throwIfAborted();
      return initializeBookWithAi(paths, context);
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
 * 兼容旧服务返回值：旧业务服务返回带 outputJson 的 Run 快照，这里只取出正文输出，
 * 避免把整份审计快照当作命令输出写入新 Run。
 */
function unwrapLegacyRun(value: unknown) {
  if (typeof value === "object" && value !== null && "outputJson" in value) {
    return (value as { outputJson: unknown }).outputJson;
  }
  return value;
}

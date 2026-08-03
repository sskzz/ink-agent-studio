import { AppError } from "../utils/errors.js";
import type { ApplicationServices } from "../runtime/applicationServices.js";

/**
 * 作品 AI 初始化触发逻辑（books.ts / ai.ts 共用）。
 * 规则：已存在进行中的初始化 Run → 复用；手动重试且存在失败/中断的 Run → 恢复该 Run；否则新建 Run。
 */

/** 视为“进行中”的 Run 状态集合。 */
const activeStatuses = new Set(["queued", "running", "cancelling"]);

/**
 * 入队作品 AI 初始化。
 * 数据库未初始化 → 503；进行中的初始化 Run 直接复用；
 * trigger 为 manual_retry 时优先恢复上次失败/中断的 Run（resumeSystem），否则新建。
 * 返回 { run, reused } 供路由层区分“新启动”与“复用”。
 */
export async function enqueueBookInitialization(
  services: ApplicationServices,
  bookId: string,
  trigger: "book_created" | "manual_retry"
) {
  if (!services.runtimeDatabase.initialized) {
    throw new AppError("运行数据库尚未初始化，无法启动作品 AI 初始化", {
      code: 15030,
      status: 503
    });
  }

  const active = services.runEventStore.listRuns({ bookId, limit: 20 })
    .find((run) => run.command.type === "initialize_book" && activeStatuses.has(run.status));
  if (active) return { run: active, reused: true };

  if (trigger === "manual_retry") {
    const resumable = services.runEventStore.listRuns({ bookId, limit: 20 })
      .find((run) => run.command.type === "initialize_book" && ["failed", "interrupted", "cancelled"].includes(run.status));
    if (resumable) {
      return { run: await services.runCoordinator.resumeSystem(resumable.id), reused: true };
    }
  }

  const run = await services.runCoordinator.enqueueSystem({
    schemaVersion: "run-command.v1",
    type: "initialize_book",
    bookId,
    input: { trigger }
  });
  return { run, reused: false };
}

/**
 * 查询作品最近一次初始化 Run 并转成 DTO；无记录或数据库未初始化时返回 null。
 */
export function latestBookInitialization(services: ApplicationServices, bookId: string) {
  if (!services.runtimeDatabase.initialized) return null;
  const run = services.runEventStore.listRuns({ bookId, limit: 20 })
    .find((item) => item.command.type === "initialize_book");
  return run ? toInitializationDto(run) : null;
}

/**
 * 把 Run 快照投影成前端可读的初始化 DTO（runId / status / stage / error）。
 * error 只取可字符串化的 message，避免把整个错误对象序列化进响应。
 */
export function toInitializationDto(run: ReturnType<ApplicationServices["runEventStore"]["getRun"]>) {
  const error = run.error && typeof run.error === "object" && "message" in run.error
    ? String((run.error as { message: unknown }).message)
    : run.error ? String(run.error) : null;
  return {
    runId: run.id,
    status: run.status,
    stage: run.currentStage,
    error
  };
}

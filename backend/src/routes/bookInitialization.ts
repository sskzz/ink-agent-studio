import { AppError } from "../utils/errors.js";
import type { ApplicationServices } from "../runtime/applicationServices.js";

const activeStatuses = new Set(["queued", "running", "cancelling"]);

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

export function latestBookInitialization(services: ApplicationServices, bookId: string) {
  if (!services.runtimeDatabase.initialized) return null;
  const run = services.runEventStore.listRuns({ bookId, limit: 20 })
    .find((item) => item.command.type === "initialize_book");
  return run ? toInitializationDto(run) : null;
}

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

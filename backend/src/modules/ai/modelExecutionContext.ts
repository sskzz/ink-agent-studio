import { AsyncLocalStorage } from "node:async_hooks";
import type { AppConfig } from "@ink-agent/contracts";
import type { RunEventStore } from "../agents/runEventStore.js";

export interface ActiveModelExecutionContext {
  runId: string;
  stage: string | null;
  signal: AbortSignal;
  eventStore: Pick<RunEventStore, "startModelAttempt" | "finishModelAttempt">;
  modelPolicy: AppConfig["models"];
}

const storage = new AsyncLocalStorage<ActiveModelExecutionContext>();

export function runWithModelExecutionContext<T>(
  context: ActiveModelExecutionContext,
  task: () => Promise<T>
) {
  return storage.run(context, task);
}

export function getActiveModelExecutionContext() {
  return storage.getStore();
}

/** 旧同步执行器设置阶段时，同步更新所在 V2 Run 的模型审计阶段。 */
export function setActiveModelExecutionStage(stage: string | null) {
  const context = storage.getStore();
  if (context) context.stage = stage;
}

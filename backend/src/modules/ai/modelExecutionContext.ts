/**
 * 文件职责：通过 AsyncLocalStorage 在异步调用链中传递"当前 Run 的模型执行上下文"。
 * 边界：只承载元数据（runId、阶段、取消信号、事件存储、模型策略），不含模型调用逻辑本身。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { AppConfig } from "@ink-agent/contracts";
import type { RunEventStore } from "../agents/runEventStore.js";

/** 模型执行上下文：供模型网关记录尝试审计、流式增量事件，并同步取消信号与重试策略。 */
export interface ActiveModelExecutionContext {
  runId: string;
  stage: string | null;
  signal: AbortSignal;
  eventStore: Pick<RunEventStore, "startModelAttempt" | "finishModelAttempt" | "appendEvent">;
  modelPolicy: AppConfig["models"];
}

const storage = new AsyncLocalStorage<ActiveModelExecutionContext>();

/** 在指定上下文中运行 task，整个异步调用链内都可读取到该上下文。 */
export function runWithModelExecutionContext<T>(
  context: ActiveModelExecutionContext,
  task: () => Promise<T>
) {
  return storage.run(context, task);
}

/** 读取当前异步调用链上的模型执行上下文，没有则返回 undefined。 */
export function getActiveModelExecutionContext() {
  return storage.getStore();
}

/** 旧同步执行器设置阶段时，同步更新所在 V2 Run 的模型审计阶段。 */
export function setActiveModelExecutionStage(stage: string | null) {
  const context = storage.getStore();
  if (context) context.stage = stage;
}

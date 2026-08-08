import type { AgentRunRecord } from "../../types/domain.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { completeRun, createRunRecord, failRun, saveRun } from "./runRepository.js";
import { setActiveModelExecutionStage } from "../ai/modelExecutionContext.js";

/** 旧同步执行器的阶段枚举（文件职责）：对应章节写作流水线的十个环节。 */
export type AgentRunStage =
  | "load_context"
  | "chapter_intent"
  | "classify_scene"
  | "compile_constraints"
  | "generate"
  | "local_review"
  | "semantic_review"
  | "repair_json"
  | "revise"
  | "final_review";

/** 旧同步执行器的运行上下文：暴露阶段切换、Token 用量累计与 trace 合并能力。 */
export interface AgentRunExecutionContext {
  run: AgentRunRecord;
  setStage(stage: AgentRunStage): void;
  addTokenUsage(key: string, value: unknown): void;
  mergeTrace(value: Record<string, unknown>): void;
}

/**
 * 旧同步执行器入口（文件职责）：把既有章节业务服务包装成带审计的 AgentRun 快照。
 * 入参：paths——工作区路径；input——Run 创建输入；task——业务执行回调。
 * 返回值：完成任务后的 Run 记录（输出写入 outputJson）。
 * 失败处理：异常统一写入 failRun 快照（保留当前阶段与已累计的 Token/trace）后重新抛出；
 * 阶段耗时（stageTimings）随 trace 一并落盘，用于排查慢环节。
 */
export async function executeAgentRun<T>(
  paths: WorkspacePaths,
  input: Parameters<typeof createRunRecord>[0],
  task: (context: AgentRunExecutionContext) => Promise<{ output: T; trace?: Record<string, unknown> }>
) {
  const run = createRunRecord(input);
  const tokenUsage: Record<string, unknown> = {};
  const trace: Record<string, unknown> = {};
  const stageTimings: Record<string, number> = {};
  let currentStage: AgentRunStage | null = null;
  let stageStartedAt = Date.now();
  const context: AgentRunExecutionContext = {
    run,
    setStage(stage) {
      // 切换阶段时先把上一阶段的耗时累计入表，再重置计时起点，保证各阶段耗时准确。
      if (currentStage) stageTimings[currentStage] = (stageTimings[currentStage] ?? 0) + Date.now() - stageStartedAt;
      currentStage = stage;
      stageStartedAt = Date.now();
      // 同步更新 AsyncLocalStorage 中的模型执行阶段，让模型尝试审计落在正确的阶段上。
      setActiveModelExecutionStage(stage);
    },
    addTokenUsage(key, value) {
      tokenUsage[key] = value;
    },
    mergeTrace(value) {
      Object.assign(trace, value);
    }
  };
  await saveRun(paths, run);
  try {
    const result = await task(context);
    // 任务正常结束：结算最后一阶段耗时，合并 trace 后标记完成。
    if (currentStage) stageTimings[currentStage] = (stageTimings[currentStage] ?? 0) + Date.now() - stageStartedAt;
    const finalTrace = { ...trace, ...result.trace, currentStage: null, stageTimings };
    return completeRun(paths, run, result.output, { tokenUsageJson: tokenUsage, styleTraceJson: finalTrace });
  } catch (error) {
    // 任务失败：同样结算阶段耗时，把失败现场写入快照再向上抛出。
    if (currentStage) stageTimings[currentStage] = (stageTimings[currentStage] ?? 0) + Date.now() - stageStartedAt;
    await failRun(paths, run, error, {
      tokenUsageJson: tokenUsage,
      styleTraceJson: { ...trace, currentStage, stageTimings }
    });
    throw error;
  }
}

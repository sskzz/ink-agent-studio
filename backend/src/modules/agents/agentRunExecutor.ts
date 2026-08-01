import type { AgentRunRecord } from "../../types/domain.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { completeRun, createRunRecord, failRun, saveRun } from "./runRepository.js";
import { setActiveModelExecutionStage } from "../ai/modelExecutionContext.js";

export type AgentRunStage =
  | "load_context"
  | "classify_scene"
  | "compile_constraints"
  | "generate"
  | "local_review"
  | "semantic_review"
  | "repair_json"
  | "revise"
  | "final_review";

export interface AgentRunExecutionContext {
  run: AgentRunRecord;
  setStage(stage: AgentRunStage): void;
  addTokenUsage(key: string, value: unknown): void;
  mergeTrace(value: Record<string, unknown>): void;
}

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
      if (currentStage) stageTimings[currentStage] = (stageTimings[currentStage] ?? 0) + Date.now() - stageStartedAt;
      currentStage = stage;
      stageStartedAt = Date.now();
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
    if (currentStage) stageTimings[currentStage] = (stageTimings[currentStage] ?? 0) + Date.now() - stageStartedAt;
    const finalTrace = { ...trace, ...result.trace, currentStage: null, stageTimings };
    return completeRun(paths, run, result.output, { tokenUsageJson: tokenUsage, styleTraceJson: finalTrace });
  } catch (error) {
    if (currentStage) stageTimings[currentStage] = (stageTimings[currentStage] ?? 0) + Date.now() - stageStartedAt;
    await failRun(paths, run, error, {
      tokenUsageJson: tokenUsage,
      styleTraceJson: { ...trace, currentStage, stageTimings }
    });
    throw error;
  }
}

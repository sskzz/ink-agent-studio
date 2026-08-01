import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspacePaths } from "../workspace/workspacePaths.js";
import { completeRun, createRunRecord, getRun, saveRun } from "./runRepository.js";
import { executeAgentRun } from "./agentRunExecutor.js";

let root: string | null = null;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = null; });

describe("run repository lifecycle", () => {
  it("persists running and completed snapshots and reads the latest state", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "ink-agent-run-"));
    const paths = createWorkspacePaths(root);
    const run = createRunRecord({ runType: "test", inputJson: {}, styleTraceJson: { styleHash: "abc" } });
    expect(run.status).toBe("running");
    expect(run.finishedAt).toBeNull();
    await saveRun(paths, run);
    await completeRun(paths, run, { ok: true }, { tokenUsageJson: { totalTokens: 12 } });
    const found = await getRun(paths, run.id);
    expect(found.status).toBe("completed");
    expect(found.tokenUsageJson).toEqual({ totalTokens: 12 });
    expect(found.styleTraceJson).toEqual({ styleHash: "abc" });
  });

  it("persists failed stage, elapsed timings and token usage", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "ink-agent-run-failure-"));
    const paths = createWorkspacePaths(root);
    let runId = "";
    await expect(executeAgentRun(paths, { runType: "failure-test", inputJson: {} }, async (context) => {
      runId = context.run.id;
      context.setStage("semantic_review");
      context.addTokenUsage("review", { totalTokens: 42 });
      throw new Error("review failed");
    })).rejects.toThrow("review failed");
    const found = await getRun(paths, runId);
    expect(found.status).toBe("failed");
    expect(found.tokenUsageJson).toEqual({ review: { totalTokens: 42 } });
    expect(found.styleTraceJson).toMatchObject({ currentStage: "semantic_review" });
  });
});

import { randomUUID } from "node:crypto";
import path from "node:path";
import { agentRunRecordSchema } from "../../schemas/runSchemas.js";
import type { AgentRunRecord } from "../../types/domain.js";
import { appendLine, ensureDirectory, readTextFile, writeTextFileAtomic, pathExists } from "../../utils/fileStore.js";
import { notFound } from "../../utils/errors.js";
import { readJsonFile } from "../../utils/jsonStore.js";
import { resolveInsideRoot } from "../../utils/safePath.js";
import { createBookPaths } from "../books/bookPaths.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";

function getRunPath(workspacePaths: WorkspacePaths, run: Pick<AgentRunRecord, "id" | "bookId">) {
  if (run.bookId) {
    return resolveInsideRoot(createBookPaths(workspacePaths, run.bookId).runsDir, `${run.id}.json`);
  }

  return resolveInsideRoot(workspacePaths.indexDir, "runs", `${run.id}.json`);
}

export function createRunRecord(input: {
  bookId?: string | null;
  runType: string;
  inputJson: unknown;
  modelConfigId?: string | null;
  promptVersion?: string | null;
  styleTraceJson?: unknown | null;
}): AgentRunRecord {
  const now = new Date().toISOString();

  return {
    id: randomUUID(),
    bookId: input.bookId ?? null,
    runType: input.runType,
    status: "running",
    inputJson: input.inputJson,
    outputJson: null,
    modelConfigId: input.modelConfigId ?? null,
    promptVersion: input.promptVersion ?? null,
    tokenUsageJson: null,
    styleTraceJson: input.styleTraceJson ?? null,
    errorMessage: null,
    startedAt: now,
    finishedAt: null
  };
}

/**
 * 保存运行快照。
 * 每个 run 都有独立 JSON 文件，同时追加到 runs.jsonl，便于问题追踪和后续恢复。
 */
export async function saveRun(workspacePaths: WorkspacePaths, run: AgentRunRecord) {
  const runPath = getRunPath(workspacePaths, run);
  await ensureDirectory(path.dirname(runPath));
  await writeTextFileAtomic(runPath, `${JSON.stringify(run, null, 2)}\n`);
  await appendLine(workspacePaths.runsLogFile, JSON.stringify(run));
  return run;
}

export async function completeRun(
  workspacePaths: WorkspacePaths,
  run: AgentRunRecord,
  outputJson: unknown,
  options: { tokenUsageJson?: unknown; styleTraceJson?: unknown } = {}
) {
  const completed: AgentRunRecord = {
    ...run,
    status: "completed",
    outputJson,
    tokenUsageJson: options.tokenUsageJson ?? run.tokenUsageJson,
    styleTraceJson: options.styleTraceJson ?? run.styleTraceJson,
    finishedAt: new Date().toISOString()
  };

  return saveRun(workspacePaths, completed);
}

export async function failRun(
  workspacePaths: WorkspacePaths,
  run: AgentRunRecord,
  error: unknown,
  options: { tokenUsageJson?: unknown; styleTraceJson?: unknown } = {}
) {
  return saveRun(workspacePaths, {
    ...run,
    status: "failed",
    errorMessage: error instanceof Error ? error.message : String(error),
    tokenUsageJson: options.tokenUsageJson ?? run.tokenUsageJson,
    styleTraceJson: options.styleTraceJson ?? run.styleTraceJson,
    finishedAt: new Date().toISOString()
  });
}

export async function getRun(workspacePaths: WorkspacePaths, runId: string, bookId?: string | null) {
  const candidatePaths = bookId
    ? [resolveInsideRoot(createBookPaths(workspacePaths, bookId).runsDir, `${runId}.json`)]
    : [resolveInsideRoot(workspacePaths.indexDir, "runs", `${runId}.json`)];

  for (const filePath of candidatePaths) {
    if (await pathExists(filePath)) {
      return readJsonFile(filePath, agentRunRecordSchema, {} as AgentRunRecord);
    }
  }

  const logExists = await pathExists(workspacePaths.runsLogFile);

  if (logExists) {
    const lines = (await readTextFile(workspacePaths.runsLogFile)).split(/\r?\n/).filter(Boolean);
    const found = lines
      .reverse()
      .map((line) => agentRunRecordSchema.safeParse(JSON.parse(line)))
      .find((result) => result.success && result.data.id === runId);

    if (found?.success) {
      return found.data;
    }
  }

  throw notFound("运行记录不存在", { runId });
}

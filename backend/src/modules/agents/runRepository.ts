import { randomUUID } from "node:crypto";
import { agentRunRecordSchema } from "../../schemas/runSchemas.js";
import type { AgentRunRecord } from "../../types/domain.js";
import { appendLine, readTextFile, writeTextFileAtomic, pathExists } from "../../utils/fileStore.js";
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
}): AgentRunRecord {
  const now = new Date().toISOString();

  return {
    id: randomUUID(),
    bookId: input.bookId ?? null,
    runType: input.runType,
    status: "completed",
    inputJson: input.inputJson,
    outputJson: null,
    modelConfigId: input.modelConfigId ?? null,
    promptVersion: input.promptVersion ?? null,
    tokenUsageJson: null,
    errorMessage: null,
    startedAt: now,
    finishedAt: now
  };
}

/**
 * 保存运行快照。
 * 每个 run 都有独立 JSON 文件，同时追加到 runs.jsonl，便于问题追踪和后续恢复。
 */
export async function saveRun(workspacePaths: WorkspacePaths, run: AgentRunRecord) {
  await writeTextFileAtomic(getRunPath(workspacePaths, run), `${JSON.stringify(run, null, 2)}\n`);
  await appendLine(workspacePaths.runsLogFile, JSON.stringify(run));
  return run;
}

export async function completeRun(workspacePaths: WorkspacePaths, run: AgentRunRecord, outputJson: unknown) {
  const completed: AgentRunRecord = {
    ...run,
    status: "completed",
    outputJson,
    finishedAt: new Date().toISOString()
  };

  return saveRun(workspacePaths, completed);
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
      .map((line) => agentRunRecordSchema.safeParse(JSON.parse(line)))
      .find((result) => result.success && result.data.id === runId);

    if (found?.success) {
      return found.data;
    }
  }

  throw notFound("运行记录不存在", { runId });
}

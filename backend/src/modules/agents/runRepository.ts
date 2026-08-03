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

/**
 * 旧 Run 快照存储（文件职责）：为旧同步执行器提供 JSON 文件 + runs.jsonl 双写存储。
 * 带作品归属的 Run 落在作品目录 runs/ 下，全局 Run 落在工作区 index/runs/ 下。
 */
function getRunPath(workspacePaths: WorkspacePaths, run: Pick<AgentRunRecord, "id" | "bookId">) {
  if (run.bookId) {
    return resolveInsideRoot(createBookPaths(workspacePaths, run.bookId).runsDir, `${run.id}.json`);
  }

  return resolveInsideRoot(workspacePaths.indexDir, "runs", `${run.id}.json`);
}

/**
 * 创建运行记录内存对象（未落盘）。
 * 入参：bookId/runType/inputJson 等业务字段。
 * 返回值：初始状态为 running 的 AgentRunRecord。
 */
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
 * 写文件采用原子替换（writeTextFileAtomic），避免写入中断损坏快照。
 */
export async function saveRun(workspacePaths: WorkspacePaths, run: AgentRunRecord) {
  const runPath = getRunPath(workspacePaths, run);
  await ensureDirectory(path.dirname(runPath));
  await writeTextFileAtomic(runPath, `${JSON.stringify(run, null, 2)}\n`);
  await appendLine(workspacePaths.runsLogFile, JSON.stringify(run));
  return run;
}

/**
 * 标记运行完成：写入输出与 Token/trace 审计后落盘。
 * 入参：run——原快照；outputJson——任务输出；options——可选审计字段。
 */
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

/**
 * 标记运行失败：记录错误信息与失败现场后落盘。
 * 入参：run——原快照；error——异常对象；options——可选审计字段。
 */
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

/**
 * 按 runId 读取运行快照。
 * 查找顺序：作品目录 runs/ → 工作区 index/runs/ → runs.jsonl 倒序扫描。
 * 失败处理：全部找不到时抛 notFound，避免静默返回空对象掩盖数据丢失。
 */
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
    // jsonl 倒序扫描：最新记录排在最前，命中即返回，避免遍历全量历史。
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

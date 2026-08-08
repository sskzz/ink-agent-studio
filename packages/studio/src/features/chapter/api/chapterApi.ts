/**
 * 章节 API：章节 CRUD 与 AI 续写调用（对应后端 routes/chapters.ts）。
 * 续写接口以 Agent Run 方式同步执行，返回完整的运行快照（含 runId 与 outputJson），
 * 这里把快照扁平化为编辑面板需要的视图（草稿、审稿摘要、降级清单）。
 */
import { apiDelete, apiGet, apiPost, apiPut } from "@/shared/api/http";
import { ApiError } from "@/shared/api/http";

/** 章节索引条目（不含正文），与后端 chapterRecordSchema 对应。 */
export interface ChapterSummary {
  id: string;
  bookId: string;
  volumeNo: number;
  chapterNo: number;
  title: string;
  fileId: string;
  wordCount: number;
  status: "planned" | "drafting" | "reviewed" | "published";
  outline: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

/** 章节详情：索引条目 + 正文 content。 */
export interface ChapterDetail extends ChapterSummary {
  content: string;
}

/** 新建章节入参：默认第 1 卷、章节号由服务端自动分配。 */
export interface ChapterCreateInput {
  title?: string;
  volumeNo?: number;
  chapterNo?: number;
  outline?: string;
  content?: string;
}

/** 更新章节入参：全部可选，只提交需要修改的字段。 */
export interface ChapterUpdateInput {
  title?: string;
  outline?: string;
  summary?: string;
  status?: ChapterSummary["status"];
  content?: string;
}

/** AI 续写任务入参。 */
export interface ChapterContinueInput {
  instruction?: string;
  selectedContextFileIds?: string[];
  sceneType?: string;
  allowDegradedStyle?: boolean;
}

/** 降级原因条目：code 为机器码，message 为可读说明，recoverable 表示是否可恢复。 */
export interface DegradationReason {
  code: string;
  message: string;
  recoverable?: boolean;
}

/** AI 续写结果（从运行快照的 outputJson.output 扁平化而来，供编辑面板展示）。 */
export interface ChapterContinueResult {
  chapterId?: string;
  /** 模型生成的待确认草稿（未写入章节正文）。 */
  draft: string;
  /** 本轮正文实际遵循的细纲；生成阶段会优先使用 AI 细纲，失败时回退静态细纲。 */
  chapterOutline?: string;
  /** 细纲来源：generated=本轮 AI 细纲，existing=章节已有细纲，none=无细纲降级。 */
  outlineSource?: "generated" | "existing" | "none";
  /** 模型为章节拟定的标题（仅当章节尚无自定义标题时生成，可为空）。 */
  chapterTitle?: string | null;
  /** 自动修订次数：0 表示未修订，1 表示已自动修订并复检。 */
  revisionCount?: number;
  /** 生成/审稿过程的警告信息。 */
  warnings: string[];
  /** 是否发生了任何降级（风格版本回退/审稿失败等）。 */
  degraded: boolean;
  /** 降级原因清单。 */
  degradationReasons: DegradationReason[];
  /** 后端附加说明（如"模型生成结果为待确认草稿"）。 */
  note?: string;
}

/** 章节列表。 */
export async function listChapters(bookId: string): Promise<ChapterSummary[]> {
  return apiGet<ChapterSummary[]>(`/books/${bookId}/chapters`);
}

/** 新建章节：成功后返回完整详情（含空正文）。 */
export async function createChapter(bookId: string, input: ChapterCreateInput): Promise<ChapterDetail> {
  return apiPost<ChapterDetail>(`/books/${bookId}/chapters`, input);
}

/** 章节详情（含正文）。 */
export async function getChapter(bookId: string, chapterId: string): Promise<ChapterDetail> {
  return apiGet<ChapterDetail>(`/books/${bookId}/chapters/${chapterId}`);
}

/** 更新章节（部分更新，返回最新详情）。 */
export async function updateChapter(bookId: string, chapterId: string, patch: ChapterUpdateInput): Promise<ChapterDetail> {
  return apiPut<ChapterDetail>(`/books/${bookId}/chapters/${chapterId}`, patch);
}

/** 删除章节（索引与正文文件一并移除，刷新作品进度；已发布章节会被后端拒绝）。 */
export async function deleteChapter(bookId: string, chapterId: string): Promise<void> {
  await apiDelete(`/books/${bookId}/chapters/${chapterId}`);
}

/**
 * 后端续写返回的运行快照：outputJson 直接包含任务输出（draft 等字段）。
 * 注意：continueChapter 任务返回的对象本身（{ chapterId, draft, ... }）就是输出，
 * 不存在 outputJson.output 的嵌套层级——此前前端按错误路径解析导致草稿永远为空。
 */
interface ContinueRunEnvelope {
  runId?: string;
  status?: string;
  outputJson?: {
    chapterId?: string;
    draft?: string;
    chapterOutline?: string;
    outlineSource?: "generated" | "existing" | "none";
    revisionCount?: number;
    warnings?: string[];
    degraded?: boolean;
    degradationReasons?: DegradationReason[];
    note?: string;
  };
}

/**
 * 异步续写：创建 continue_chapter Run（后端经队列调度，SSE 事件流实时推送进度与正文增量）。
 * 返回 runId 供订阅；最终输出通过 run_completed 事件或 getRun(runId).outputJson 获取。
 */
export async function createContinueRun(bookId: string, chapterId: string, input: ChapterContinueInput): Promise<{ runId: string; eventsUrl: string }> {
  const accepted = await apiPost<{ runId: string; eventsUrl: string }>("/runs", {
    command: {
      schemaVersion: "run-command.v1",
      type: "continue_chapter",
      bookId,
      chapterId,
      input
    }
  });
  return { runId: accepted.runId, eventsUrl: accepted.eventsUrl };
}

/**
 * 从续写 Run 快照中解析扁平化的续写结果（run_completed 事件的 output 或 getRun 的 outputJson）。
 * 兼容两种形态：pipeline 直接输出（{ chapterId, draft, ... }）或嵌套 { output: {...}, trace: {...} }。
 */
export function resolveContinueResult(value: unknown): ChapterContinueResult | null {
  if (typeof value !== "object" || value === null) return null;
  const root = value as Record<string, unknown>;
  const output = root.outputJson ?? root.output ?? root;
  const draft = typeof output === "object" && output !== null
    ? (output as Record<string, unknown>).draft
    : undefined;
  if (typeof draft !== "string") return null;
  return {
    chapterId: typeof root.chapterId === "string"
      ? root.chapterId
      : typeof output === "object" && output !== null && typeof (output as Record<string, unknown>).chapterId === "string"
        ? (output as Record<string, unknown>).chapterId as string
        : undefined,
    draft,
    chapterTitle: typeof output === "object" && output !== null
      ? (output as Record<string, unknown>).chapterTitle as string | null | undefined
      : undefined,
    chapterOutline: typeof output === "object" && output !== null
      ? (output as Record<string, unknown>).chapterOutline as string | undefined
      : undefined,
    outlineSource: typeof output === "object" && output !== null
      && ["generated", "existing", "none"].includes(String((output as Record<string, unknown>).outlineSource))
      ? (output as Record<string, unknown>).outlineSource as "generated" | "existing" | "none"
      : undefined,
    revisionCount: typeof output === "object" && output !== null
      ? (output as Record<string, unknown>).revisionCount as number | undefined
      : undefined,
    warnings: Array.isArray(output && (output as Record<string, unknown>).warnings)
      ? (output as Record<string, unknown>).warnings as string[]
      : [],
    degraded: Boolean(output && (output as Record<string, unknown>).degraded),
    degradationReasons: Array.isArray(output && (output as Record<string, unknown>).degradationReasons)
      ? (output as Record<string, unknown>).degradationReasons as DegradationReason[]
      : [],
    note: output && (output as Record<string, unknown>).note as string | undefined
  };
}

/**
 * AI 续写章节（同步兼容路径）：调用后端同步模型管线并返回扁平化结果。
 * 前端已切换异步 Run + SSE，此方法保留供非实时场景与回退使用。
 */
export async function continueChapter(bookId: string, chapterId: string, input: ChapterContinueInput): Promise<ChapterContinueResult> {
  const run = await apiPost<ContinueRunEnvelope>(`/books/${bookId}/chapters/${chapterId}/continue`, input);
  const output = run.outputJson;
  if (!output || typeof output.draft !== "string") {
    throw new Error(`AI 续写返回结构异常${run.status ? `（运行状态：${run.status}）` : ""}`);
  }
  return {
    chapterId: output.chapterId,
    draft: output.draft,
    chapterOutline: output.chapterOutline,
    outlineSource: output.outlineSource,
    revisionCount: output.revisionCount,
    warnings: output.warnings ?? [],
    degraded: output.degraded ?? false,
    degradationReasons: output.degradationReasons ?? [],
    note: output.note
  };
}

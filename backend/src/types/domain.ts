/**
 * 领域核心类型定义。
 * 与 schemas 目录的 Zod schema 一一对应，这里只声明类型，不含运行时校验。
 */

/** 作品生命周期状态。 */
export type BookStatus = "planning" | "drafting" | "reviewing" | "paused";

/** 实体（设定条目）类型。 */
export type EntityType = "character" | "faction" | "location" | "item";

/** 作品文件类型，决定文件在 books/{bookId}/files 下的存盘位置与用途。 */
export type BookFileType =
  | "brief"
  | "outline"
  | "world"
  | "current_state"
  | "foreshadowing"
  | "chapter"
  | "entity"
  | "import";

/** 模型供应商标识，决定适配器选择。 */
export type ModelProvider =
  | "openai"
  | "azure-openai"
  | "openai-compatible"
  | "anthropic"
  | "ollama"
  | "lmstudio"
  | "vllm"
  | "deepseek"
  | "gemini"
  | "qwen"
  | "moonshot"
  | "zhipu"
  | "doubao"
  | "baichuan"
  | "baidu-qianfan"
  | "tencent-hunyuan"
  | "minimax"
  | "mistral"
  | "xai"
  | "cohere"
  | "openrouter"
  | "oneapi"
  | "litellm"
  | "custom";

/** 模型用途，用于模型路由选择（写作 / 审稿 / 规划等）。 */
export type ModelPurpose = "planning" | "writing" | "review" | "embedding" | "image";

/** Agent 运行状态机。 */
export type AgentRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

/**
 * 作品规范状态。
 * 后端第一版会把它保存到 books/{bookId}/book.json，前端作品详情也会基于这个结构渲染。
 */
export interface BookRecord {
  id: string;
  title: string;
  genre: string;
  status: BookStatus;
  narrationPerspective: string;
  channel: string;
  writingStyleId: string | null;
  writingStyleVersionId: string | null;
  protagonistGender: string;
  protagonistName: string;
  plannedWords: number | null;
  chapterWords: number | null;
  writtenWords: number;
  writtenChapters: number;
  currentChapterId: string | null;
  worldFileId: string | null;
  needsAiFill: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * 作品文件记录（book.json 之外的单个文件条目），保存在 books/{bookId}/index.json。
 */
export interface BookFileRecord {
  id: string;
  bookId: string;
  fileType: BookFileType;
  title: string;
  path: string;
  summary: string;
  contentHash: string | null;
  parsedJson: unknown | null;
  createdAt: string;
  updatedAt: string;
}

/** 作品实体条目，保存在 books/{bookId}/entities/index.json。 */
export interface BookEntityRecord {
  id: string;
  bookId: string;
  entityType: EntityType;
  name: string;
  role: string;
  description: string;
  fileId: string | null;
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** 章节记录，保存在 books/{bookId}/chapters/index.json。 */
export interface ChapterRecord {
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
  revision: number;
  contentHash: string | null;
  stateSyncStatus: "pending" | "processing" | "synced" | "failed" | "stale";
  stateSyncRevision: number;
  stateSyncError: string | null;
  stateSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 思考模式配置（DeepSeek V4）：enabled 开关 + effort 推理强度（null 表示用服务商默认档）。 */
export interface ModelThinkingConfig {
  enabled: boolean;
  effort: "low" | "high" | "max" | null;
}

export interface ModelCapabilities {
  contextWindow?: number;
  maxOutputTokens?: number;
  reasoningReserveTokens?: number;
  supportsThinking?: boolean;
  supportsJsonSchema?: boolean;
  supportsStreaming?: boolean;
  pricing?: {
    currency: string;
    promptMicrosPerMillionTokens: number;
    completionMicrosPerMillionTokens: number;
  };
  [key: string]: unknown;
}

/** 模型配置记录，保存在 config/model-configs.json；apiKey 不落盘在此。 */
export interface ModelConfigRecord {
  id: string;
  name: string;
  provider: ModelProvider;
  baseUrl: string;
  apiModel: string;
  purpose: ModelPurpose;
  enabled: boolean;
  isDefault: boolean;
  capabilities: ModelCapabilities;
  thinking: ModelThinkingConfig | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

/** 模型路由映射：写作 / 审稿 / 规划各绑定一个模型配置 id。 */
export interface ModelRouteRecord {
  writingModelId: string | null;
  reviewModelId: string | null;
  planningModelId: string | null;
}

/** Agent 运行记录（JSONL 追加日志中的一行），可回放事件流。 */
export interface AgentRunRecord {
  id: string;
  bookId: string | null;
  runType: string;
  status: AgentRunStatus;
  inputJson: unknown;
  outputJson: unknown | null;
  modelConfigId: string | null;
  promptVersion: string | null;
  tokenUsageJson: unknown | null;
  styleTraceJson: unknown | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

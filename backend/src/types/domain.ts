export type BookStatus = "planning" | "drafting" | "reviewing" | "paused";

export type EntityType = "character" | "faction" | "location" | "item";

export type BookFileType =
  | "brief"
  | "outline"
  | "world"
  | "current_state"
  | "foreshadowing"
  | "chapter"
  | "entity"
  | "import";

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

export type ModelPurpose = "planning" | "writing" | "review" | "embedding" | "image";

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
  createdAt: string;
  updatedAt: string;
}

export interface ModelConfigRecord {
  id: string;
  name: string;
  provider: ModelProvider;
  baseUrl: string;
  apiModel: string;
  purpose: ModelPurpose;
  enabled: boolean;
  isDefault: boolean;
  capabilities: Record<string, unknown>;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelRouteRecord {
  writingModelId: string | null;
  reviewModelId: string | null;
  planningModelId: string | null;
}

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
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

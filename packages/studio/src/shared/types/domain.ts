export type BookStatus = "drafting" | "planning" | "reviewing" | "paused";

/**
 * 模型服务商类型。
 *
 * 这里先覆盖本地 Agent 创作系统最常见的几类服务。
 * 后续如果要支持更多厂商，只需要扩展这个联合类型和模型配置页的选项。
 */
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

/**
 * 模型用途。
 *
 * InkOS 类系统通常不会用同一个模型处理所有任务：
 * 规划、写作、审稿、向量检索、封面提示词都可以使用不同模型。
 */
export type ModelPurpose = "planning" | "writing" | "review" | "embedding" | "image";

export interface BookSummary {
  id: string;
  title: string;
  genre: string;
  status: BookStatus;
  chapterCount: number;
  updatedAt: string;
}

export interface AgentRun {
  id: string;
  name: string;
  phase: string;
  status: "queued" | "running" | "completed" | "failed";
  startedAt: string;
}

export interface ModelProfile {
  id: string;
  name: string;
  provider: string;
  purpose: ModelPurpose;
}

/**
 * 前端模型配置实体。
 *
 * 当前通过 Hono 后端保存到本地 workspace；apiKey 字段只用于表单提交，
 * 后端列表和详情接口不会回显真实密钥。
 */
export interface ModelConfig {
  id: string;
  name: string;
  provider: ModelProvider;
  baseUrl: string;
  apiKey: string;
  apiModel: string;
  purpose: ModelPurpose;
  enabled: boolean;
  isDefault: boolean;
  capabilities: {
    pricing?: {
      currency?: string;
      promptMicrosPerMillionTokens?: number;
      completionMicrosPerMillionTokens?: number;
    };
    [key: string]: unknown;
  };
  note: string;
  updatedAt: string;
}

/**
 * 表单草稿类型。
 *
 * id 和 updatedAt 由保存逻辑统一生成/维护，避免表单页面关心持久化细节。
 */
export type ModelConfigDraft = Omit<ModelConfig, "id" | "updatedAt"> & {
  id?: string;
};

export interface ModelConnectionResult {
  ok: boolean;
  message: string;
  checkedAt: string;
}

/**
 * 模型使用分配。
 *
 * 模型列表负责保存“有哪些模型”，这里负责保存“写作/审稿分别用哪一个模型”。
 * 后续接后端时，可以落到 workspace settings 或独立 model-routing.json。
 */
export interface ModelUsageSettings {
  writingModelId: string | null;
  reviewModelId: string | null;
  planningModelId: string | null;
}

export interface ModelAnalysisIssue {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  targetId: string | null;
  targetType: "config" | "route" | "system";
}

export interface ModelRouteAnalysis {
  routeKey: "writingModelId" | "reviewModelId" | "planningModelId";
  label: string;
  modelConfigId: string | null;
  modelName: string;
  provider: string;
  ready: boolean;
  issues: string[];
}

export interface ModelAnalysis {
  generatedAt: string;
  score: number;
  status: "ready" | "partial" | "blocked";
  summary: {
    totalConfigs: number;
    enabledConfigs: number;
    disabledConfigs: number;
    defaultModelName: string | null;
    supportedAdapterConfigs: number;
    routeReadyCount: number;
  };
  providerStats: Array<{ key: ModelProvider; enabled: number; total: number }>;
  purposeStats: Array<{ key: ModelPurpose; enabled: number; total: number }>;
  routes: ModelRouteAnalysis[];
  issues: ModelAnalysisIssue[];
  suggestions: string[];
}

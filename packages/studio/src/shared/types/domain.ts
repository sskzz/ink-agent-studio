/**
 * 共享领域类型：作品、模型配置、运行记录等跨功能页复用的实体定义。
 * 约定：与后端本地 Hono 服务的 JSON 结构保持一致，后端改动字段时优先同步此文件。
 */

/** 作品状态：撰写中 / 规划中 / 审稿中 / 已暂停。 */
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

/** 作品库列表项摘要：用于作品卡片与列表渲染。 */
export interface BookSummary {
  id: string;
  title: string;
  genre: string;
  status: BookStatus;
  chapterCount: number;
  updatedAt: string;
}

/** 一次 Agent 任务的运行摘要：展示在运行记录页的事件流与状态时间线中。 */
export interface AgentRun {
  id: string;
  name: string;
  phase: string;
  status: "queued" | "running" | "completed" | "failed";
  startedAt: string;
}

/** 模型配置列表项摘要：用于模型列表页的轻量展示。 */
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
/** 思考模式配置（DeepSeek V4）：enabled 开关 + effort 推理强度（null 表示用服务商默认档）。 */
export interface ModelThinkingConfig {
  enabled: boolean;
  effort: "low" | "high" | "max" | null;
}

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
  thinking: ModelThinkingConfig | null;
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

/** 模型连通性测试结果：ok 表示可直接使用，message 为失败原因或成功提示。 */
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

/** 模型分析发现的单个问题：severity 决定列表中的警示级别，targetType 指明问题归属。 */
export interface ModelAnalysisIssue {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  targetId: string | null;
  targetType: "config" | "route" | "system";
}

/** 单条调用链路（如“写作”）的配置体检结果：ready 表示该链路可直接使用。 */
export interface ModelRouteAnalysis {
  routeKey: "writingModelId" | "reviewModelId" | "planningModelId";
  label: string;
  modelConfigId: string | null;
  modelName: string;
  provider: string;
  ready: boolean;
  issues: string[];
}

/** 模型配置整体分析结果：汇总统计、各服务商/用途分布、链路体检、问题清单与改进建议。 */
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

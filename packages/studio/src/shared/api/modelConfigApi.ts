import type {
  ModelConfig,
  ModelConfigDraft,
  ModelConnectionResult,
  ModelUsageSettings
} from "@/shared/types/domain";

const STORAGE_KEY = "ink-agent-studio:model-configs:v1";
const USAGE_STORAGE_KEY = "ink-agent-studio:model-usage:v1";

/**
 * 默认示例配置。
 *
 * 注意：这不是有效密钥，只是为了让页面首次打开时有数据可看。
 * 后续接真实后端后，默认配置应从本地 workspace 的 settings 文件读取。
 */
const seedConfigs: ModelConfig[] = [
  {
    id: "demo-openai-compatible",
    name: "默认写作模型",
    provider: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    apiKey: "",
    model: "writer-large",
    purpose: "writing",
    temperature: 0.72,
    maxTokens: 4096,
    enabled: true,
    isDefault: true,
    note: "用于章节正文生成。真实接入时请替换 Base URL、模型名和 API Key。",
    updatedAt: new Date().toISOString()
  },
  {
    id: "demo-ollama-local",
    name: "本地审稿模型",
    provider: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "",
    model: "qwen2.5:7b",
    purpose: "review",
    temperature: 0.35,
    maxTokens: 2048,
    enabled: false,
    isDefault: false,
    note: "用于演示本地模型配置，第一版仅做前端占位。",
    updatedAt: new Date().toISOString()
  }
];

function wait(ms = 220) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function createId() {
  if ("crypto" in window && "randomUUID" in window.crypto) {
    return window.crypto.randomUUID();
  }

  return `model-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readConfigs(): ModelConfig[] {
  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seedConfigs));
    return seedConfigs;
  }

  try {
    return JSON.parse(raw) as ModelConfig[];
  } catch {
    // 如果本地缓存被手动改坏，前端先自愈，避免整个页面白屏。
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seedConfigs));
    return seedConfigs;
  }
}

function writeConfigs(configs: ModelConfig[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
}

function readUsage(): ModelUsageSettings {
  const raw = window.localStorage.getItem(USAGE_STORAGE_KEY);

  if (!raw) {
    const configs = readConfigs();
    const usage: ModelUsageSettings = {
      writingModelId: configs.find((config) => config.purpose === "writing")?.id ?? configs[0]?.id ?? null,
      reviewModelId: configs.find((config) => config.purpose === "review")?.id ?? null
    };
    window.localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(usage));
    return usage;
  }

  try {
    return JSON.parse(raw) as ModelUsageSettings;
  } catch {
    const usage: ModelUsageSettings = { writingModelId: null, reviewModelId: null };
    window.localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(usage));
    return usage;
  }
}

function writeUsage(usage: ModelUsageSettings) {
  window.localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(usage));
}

/**
 * 预留接口：读取模型配置列表。
 *
 * 当前实现使用 localStorage 模拟异步请求；后续接后端时，把函数体替换成：
 * return apiGet<ModelConfig[]>("/api/v1/model-configs")
 */
export async function listModelConfigs(): Promise<ModelConfig[]> {
  await wait();
  return readConfigs();
}

/**
 * 预留接口：保存模型配置。
 *
 * 当前前端模拟了新增/编辑逻辑；真实后端应负责 API Key 加密、文件写入和校验。
 */
export async function saveModelConfig(draft: ModelConfigDraft): Promise<ModelConfig> {
  await wait();

  const configs = readConfigs();
  const now = new Date().toISOString();
  const saved: ModelConfig = {
    ...draft,
    id: draft.id ?? createId(),
    updatedAt: now
  };

  let nextConfigs = configs.some((config) => config.id === saved.id)
    ? configs.map((config) => (config.id === saved.id ? saved : config))
    : [saved, ...configs];

  // 默认模型只能有一个；如果当前保存的草稿被标记为默认，其他配置自动取消默认。
  if (saved.isDefault) {
    nextConfigs = nextConfigs.map((config) => ({
      ...config,
      isDefault: config.id === saved.id
    }));
  }

  writeConfigs(normalizeDefault(nextConfigs));
  return saved;
}

export async function deleteModelConfig(id: string): Promise<void> {
  await wait();
  writeConfigs(normalizeDefault(readConfigs().filter((config) => config.id !== id)));
}

/**
 * 预留接口：把某个配置设置为默认模型。
 *
 * 默认模型用于后续 Agent Pipeline 在没有显式指定模型时选择调用对象。
 */
export async function setDefaultModelConfig(id: string): Promise<ModelConfig[]> {
  await wait();
  const configs = readConfigs().map((config) => ({
    ...config,
    isDefault: config.id === id
  }));
  writeConfigs(configs);
  return configs;
}

export async function getModelUsageSettings(): Promise<ModelUsageSettings> {
  await wait();
  return readUsage();
}

/**
 * 预留接口：设置写作/审稿阶段使用的模型。
 *
 * 目前只保存模型 id。真实后端接入后，可以在 Agent Pipeline 启动时读取这份路由配置。
 */
export async function setPurposeModel(
  purpose: "writing" | "review",
  modelId: string
): Promise<ModelUsageSettings> {
  await wait();
  const usage = readUsage();
  const nextUsage: ModelUsageSettings =
    purpose === "writing"
      ? { ...usage, writingModelId: modelId }
      : { ...usage, reviewModelId: modelId };
  writeUsage(nextUsage);
  return nextUsage;
}

/**
 * 预留接口：测试模型连接。
 *
 * 第一版只做表单完整性检查，不真正请求模型服务。
 * 后续后端实现时，应由后端发起连接测试，避免 API Key 暴露在浏览器请求日志里。
 */
export async function testModelConnection(
  draft: ModelConfigDraft
): Promise<ModelConnectionResult> {
  await wait(520);

  const missingFields = [
    !draft.name && "配置名称",
    !draft.baseUrl && "Base URL",
    !draft.model && "模型名称"
  ].filter(Boolean);

  if (missingFields.length > 0) {
    return {
      ok: false,
      message: `缺少必要字段：${missingFields.join("、")}`,
      checkedAt: new Date().toISOString()
    };
  }

  return {
    ok: true,
    message: "前端校验通过。真实连接测试将在后端 API 接入后执行。",
    checkedAt: new Date().toISOString()
  };
}

function normalizeDefault(configs: ModelConfig[]) {
  if (configs.length === 0) {
    return configs;
  }

  if (configs.some((config) => config.isDefault)) {
    return configs;
  }

  return configs.map((config, index) => ({
    ...config,
    isDefault: index === 0
  }));
}

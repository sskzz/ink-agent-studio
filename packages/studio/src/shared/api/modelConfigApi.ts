import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/shared/api/http";
import type {
  ModelAnalysis,
  ModelConfig,
  ModelConfigDraft,
  ModelConnectionResult,
  ModelUsageSettings
} from "@/shared/types/domain";

type BackendModelRoutes = ModelUsageSettings;
type BackendModelConfig = Omit<ModelConfig, "apiKey" | "apiModel"> & {
  apiKey?: string;
  apiModel?: string;
  model?: string;
};

/**
 * 后端为了安全不会回显真实 API Key。
 * 前端统一把缺失的 apiKey 补为空字符串，保证模型配置表单仍然可以直接复用同一份类型。
 */
function normalizeModelConfig(config: BackendModelConfig): ModelConfig {
  const { apiKey, apiModel, model, ...rest } = config;
  return {
    ...rest,
    apiKey: apiKey ?? "",
    apiModel: apiModel ?? model ?? ""
  };
}

function normalizeUsage(routes: BackendModelRoutes): ModelUsageSettings {
  return {
    writingModelId: routes.writingModelId ?? null,
    reviewModelId: routes.reviewModelId ?? null,
    planningModelId: routes.planningModelId ?? null
  };
}

function getMissingFields(draft: ModelConfigDraft) {
  return [
    !draft.name.trim() && "配置名称",
    !draft.baseUrl.trim() && "Base URL",
    !draft.apiModel.trim() && "API 调用模型"
  ].filter(Boolean) as string[];
}

/**
 * 读取模型配置列表。
 * 数据来自本地 Hono 后端的 workspace 配置文件，不再使用浏览器 localStorage。
 */
export async function listModelConfigs(): Promise<ModelConfig[]> {
  const configs = await apiGet<BackendModelConfig[]>("/model-configs");
  return configs.map(normalizeModelConfig);
}

/**
 * 新增或更新模型配置。
 * 新增走 POST，编辑走 PATCH；API Key 仅在用户输入非空时由后端写入本地 secrets 文件。
 */
export async function saveModelConfig(draft: ModelConfigDraft): Promise<ModelConfig> {
  const saved = draft.id
    ? await apiPatch<BackendModelConfig>(`/model-configs/${draft.id}`, draft)
    : await apiPost<BackendModelConfig>("/model-configs", draft);

  return normalizeModelConfig(saved);
}

export async function deleteModelConfig(id: string): Promise<void> {
  await apiDelete<{ id: string }>(`/model-configs/${id}`);
}

/**
 * 设置默认模型。
 * 默认模型用于未显式选择模型的 Agent 任务，后端会保证同一时间只有一个默认配置。
 */
export async function setDefaultModelConfig(id: string): Promise<ModelConfig[]> {
  const configs = await apiPost<BackendModelConfig[]>(`/model-configs/${id}/default`);
  return configs.map(normalizeModelConfig);
}

export async function getModelUsageSettings(): Promise<ModelUsageSettings> {
  const routes = await apiGet<BackendModelRoutes>("/model-routes");
  return normalizeUsage(routes);
}

export async function getModelAnalysis(): Promise<ModelAnalysis> {
  return apiGet<ModelAnalysis>("/model-analysis");
}

export async function discoverAvailableModels(draft: ModelConfigDraft): Promise<string[]> {
  const result = await apiPost<{ models: string[]; fetchedAt: string }>("/model-configs/discover-models", {
    id: draft.id,
    provider: draft.provider,
    baseUrl: draft.baseUrl,
    apiKey: draft.apiKey
  });
  return result.models;
}

/**
 * 设置规划、写作或审稿阶段使用的模型。
 */
export async function setPurposeModel(
  purpose: "planning" | "writing" | "review",
  modelId: string
): Promise<ModelUsageSettings> {
  const routes = await apiPut<BackendModelRoutes>(`/model-routes/${purpose}`, {
    modelConfigId: modelId || null
  });
  return normalizeUsage(routes);
}

/**
 * 测试模型连接。
 * 先在前端检查必填项，避免空表单直接请求真实模型网关；字段完整后由后端代理测试，防止密钥暴露。
 */
export async function testModelConnection(
  draft: ModelConfigDraft
): Promise<ModelConnectionResult> {
  const missingFields = getMissingFields(draft);

  if (missingFields.length > 0) {
    return {
      ok: false,
      message: `缺少必要字段：${missingFields.join("、")}`,
      checkedAt: new Date().toISOString()
    };
  }

  return apiPost<ModelConnectionResult>("/model-configs/test", draft);
}

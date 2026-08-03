/**
 * 模型配置 API：列表/增删改查、默认模型、用途分配、连通性测试与分析报告。
 * 安全约定：API Key 只在提交/测试时传给后端，任何读取接口都不会回显真实密钥。
 */
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

/** 后端用途分配接口可能缺字段，统一归并为空值 null，保持前端类型稳定。 */
function normalizeUsage(routes: BackendModelRoutes): ModelUsageSettings {
  return {
    writingModelId: routes.writingModelId ?? null,
    reviewModelId: routes.reviewModelId ?? null,
    planningModelId: routes.planningModelId ?? null
  };
}

/** 校验测试连接前的必填项（名称 / Base URL / 模型名），缺失时返回字段中文名列表。 */
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

/** 删除一条模型配置；同时清理其在用途分配中的引用由后端完成。 */
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

/** 读取规划/写作/审稿三条调用链路的模型分配。 */
export async function getModelUsageSettings(): Promise<ModelUsageSettings> {
  const routes = await apiGet<BackendModelRoutes>("/model-routes");
  return normalizeUsage(routes);
}

/** 模型配置体检报告：由后端汇总配置与链路状态生成，页面只负责展示。 */
export async function getModelAnalysis(): Promise<ModelAnalysis> {
  return apiGet<ModelAnalysis>("/model-analysis");
}

/** 请求服务商列出可用模型：用于表单中的模型名下拉；失败由调用方兜底提示。 */
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

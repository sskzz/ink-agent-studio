/**
 * 文件职责：模型配置/路由的对外服务层：输入校验、API Key 脱敏、连接测试与模型发现。
 * 边界：所有出参都抹掉 API Key（apiKey 恒为空串）；真实网络调用委托给 modelGateway。
 */
import {
  modelConnectionTestInputSchema,
  modelDiscoveryInputSchema,
  modelConfigUpsertInputSchema,
  modelRouteKeySchema,
  modelRouteUpdateInputSchema,
  type ModelRouteKey
} from "../../schemas/modelSchemas.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { listAvailableModels, testModelConnection } from "../ai/modelGateway.js";
import { analyzeModelSetup } from "../ai/modelAnalysisService.js";
import { badRequest } from "../../utils/errors.js";
import {
  deleteModelConfig,
  getModelConfig,
  getModelRoutes,
  listModelConfigs,
  saveModelConfig,
  setDefaultModelConfig,
  setModelRoute
} from "./modelConfigRepository.js";

/** 对外脱敏：API Key 一律替换为空串，防止泄露给前端。 */
export function toPublicModelConfig(config: Awaited<ReturnType<typeof getModelConfig>>) {
  return {
    ...config,
    apiKey: ""
  };
}

/** 模型配置列表（脱敏）。 */
export async function listPublicModelConfigs(paths: WorkspacePaths) {
  const configs = await listModelConfigs(paths);
  return configs.map((config) => toPublicModelConfig(config));
}

/** 单个模型配置（脱敏）。 */
export async function getPublicModelConfig(paths: WorkspacePaths, id: string) {
  return toPublicModelConfig(await getModelConfig(paths, id));
}

/** 新增模型配置（脱敏返回）。 */
export async function savePublicModelConfig(paths: WorkspacePaths, body: unknown) {
  const input = modelConfigUpsertInputSchema.parse(body);
  return toPublicModelConfig(await saveModelConfig(paths, input));
}

/** 局部更新模型配置：以现有配置为底合并补丁后走统一保存路径。 */
export async function patchPublicModelConfig(paths: WorkspacePaths, id: string, body: unknown) {
  const current = await getModelConfig(paths, id);
  const patch = typeof body === "object" && body !== null ? body : {};
  const input = modelConfigUpsertInputSchema.parse({
    ...current,
    ...patch,
    id
  });
  return toPublicModelConfig(await saveModelConfig(paths, input));
}

/** 删除模型配置。 */
export async function deletePublicModelConfig(paths: WorkspacePaths, id: string) {
  await deleteModelConfig(paths, id);
  return { id };
}

/** 设置默认模型并返回脱敏后的配置列表。 */
export async function markPublicDefaultModel(paths: WorkspacePaths, id: string) {
  const configs = await setDefaultModelConfig(paths, id);
  return configs.map((config) => toPublicModelConfig(config));
}

/** 读取模型路由。 */
export async function readPublicModelRoutes(paths: WorkspacePaths) {
  return getModelRoutes(paths);
}

/** 更新单个用途的路由，routeKey 与 body 均做 schema 校验。 */
export async function updatePublicModelRoute(paths: WorkspacePaths, routeKey: string, body: unknown) {
  const parsedRouteKey = modelRouteKeySchema.parse(routeKey) as ModelRouteKey;
  const input = modelRouteUpdateInputSchema.parse(body);
  return setModelRoute(paths, parsedRouteKey, input.modelConfigId);
}

/**
 * 连接测试：用请求体现场组装一个草稿配置（不落盘）调用网关测试。
 * API Key 直接从请求中透传，测试通过后再由保存接口决定是否持久化。
 */
export async function testPublicModelConnection(paths: WorkspacePaths, body: unknown) {
  const input = modelConnectionTestInputSchema.parse(body);
  const now = new Date().toISOString();
  const config = {
    id: input.id ?? "draft-model-config",
    name: input.name,
    provider: input.provider,
    baseUrl: input.baseUrl,
    apiModel: input.apiModel,
    purpose: input.purpose,
    enabled: input.enabled,
    isDefault: input.isDefault,
    capabilities: input.capabilities ?? {},
    thinking: input.thinking ?? null,
    note: input.note ?? "",
    createdAt: now,
    updatedAt: now
  };

  return testModelConnection(paths, config, input.apiKey ?? "");
}

/**
 * 模型发现：拉取服务商可用的模型列表供前端选择。
 * 已保存的配置沿用其元数据；拉取失败统一转为 badRequest 呈现原因。
 */
export async function discoverPublicModels(paths: WorkspacePaths, body: unknown) {
  const input = modelDiscoveryInputSchema.parse(body);
  const existing = input.id ? await getModelConfig(paths, input.id) : null;
  const now = new Date().toISOString();
  const config = {
    id: input.id ?? "draft-model-config",
    name: existing?.name ?? "draft-model-config",
    provider: input.provider,
    baseUrl: input.baseUrl,
    apiModel: existing?.apiModel ?? "",
    purpose: existing?.purpose ?? ("writing" as const),
    enabled: existing?.enabled ?? true,
    isDefault: existing?.isDefault ?? false,
    capabilities: existing?.capabilities ?? {},
    thinking: existing?.thinking ?? null,
    note: existing?.note ?? "",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  try {
    const models = await listAvailableModels(paths, config, input.apiKey);
    return { models, fetchedAt: now };
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : "获取模型列表失败");
  }
}

/** 模型体系健康度分析（脱敏、纯本地计算）。 */
export async function analyzePublicModelSetup(paths: WorkspacePaths) {
  return analyzeModelSetup(paths);
}

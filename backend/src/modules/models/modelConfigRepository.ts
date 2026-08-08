/**
 * 文件职责：模型配置与路由的本地仓库：配置增删改、默认配置、路由读写。
 * 边界：只做持久化与基础一致性；API Key 不落普通配置文件（委托 secretStore），
 * 对外暴露前的脱敏由 modelConfigService 完成。
 */
import { randomUUID } from "node:crypto";
import {
  modelConfigsIndexSchema,
  modelRoutesSchema,
  type ModelConfigUpsertInput,
  type ModelRouteKey
} from "../../schemas/modelSchemas.js";
import type { ModelConfigRecord, ModelRouteRecord } from "../../types/domain.js";
import { notFound } from "../../utils/errors.js";
import { readJsonFile, writeJsonFile } from "../../utils/jsonStore.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { deleteModelSecret, saveModelSecret } from "./secretStore.js";

/** 路由文件缺失时的默认值：三个用途均未指定模型。 */
const defaultRoutes: ModelRouteRecord = {
  writingModelId: null,
  reviewModelId: null,
  planningModelId: null
};

/** 模型配置列表，文件缺失时返回空数组。 */
export async function listModelConfigs(paths: WorkspacePaths) {
  return readJsonFile(paths.modelConfigsFile, modelConfigsIndexSchema, []);
}

/** 按 id 读取单个配置，不存在则抛 notFound。 */
export async function getModelConfig(paths: WorkspacePaths, id: string) {
  const configs = await listModelConfigs(paths);
  const config = configs.find((item) => item.id === id);

  if (!config) {
    throw notFound("模型配置不存在", { id });
  }

  return config;
}

/** 写入配置列表，写入前保证默认配置的归一性。 */
async function writeModelConfigs(paths: WorkspacePaths, configs: ModelConfigRecord[]) {
  await writeJsonFile(paths.modelConfigsFile, normalizeDefault(configs));
}

/** 归一化默认配置：列表非空且无默认配置时，强制把第一个设为首选，保证调用方永远能拿到默认值。 */
function normalizeDefault(configs: ModelConfigRecord[]) {
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

/**
 * 保存模型配置。
 * API Key 只在输入中短暂出现；如果传入非空密钥，会立刻写入 secrets 文件，普通配置文件只保存非敏感字段。
 */
/** 保存或更新配置；新配置设为默认时清除其余配置的默认标记。API Key 单独写入 secrets 文件。 */
export async function saveModelConfig(paths: WorkspacePaths, input: ModelConfigUpsertInput) {
  const configs = await listModelConfigs(paths);
  const now = new Date().toISOString();
  const existing = input.id ? configs.find((config) => config.id === input.id) : null;
  const id = existing?.id ?? input.id ?? randomUUID();

  const saved: ModelConfigRecord = {
    id,
    name: input.name,
    provider: input.provider,
    baseUrl: input.baseUrl,
    apiModel: input.apiModel,
    purpose: input.purpose,
    enabled: input.enabled,
    isDefault: input.isDefault,
    capabilities: input.capabilities ?? existing?.capabilities ?? {},
    thinking: input.thinking ?? existing?.thinking ?? null,
    note: input.note,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  let nextConfigs = existing
    ? configs.map((config) => (config.id === id ? saved : config))
    : [saved, ...configs];

  if (saved.isDefault) {
    nextConfigs = nextConfigs.map((config) => ({
      ...config,
      isDefault: config.id === id
    }));
  }

  await writeModelConfigs(paths, nextConfigs);

  if (input.apiKey.trim()) {
    await saveModelSecret(paths, id, input.apiKey.trim());
  }

  return saved;
}

/** 删除配置：同步删除其密钥，并清理路由中对该配置的引用，避免路由指向不存在的模型。 */
export async function deleteModelConfig(paths: WorkspacePaths, id: string) {
  const configs = await listModelConfigs(paths);
  const nextConfigs = configs.filter((config) => config.id !== id);

  if (nextConfigs.length === configs.length) {
    throw notFound("模型配置不存在", { id });
  }

  await writeModelConfigs(paths, nextConfigs);
  await deleteModelSecret(paths, id);
  await removeDeletedConfigFromRoutes(paths, id);
}

/** 设置默认配置：先把目标配置标为默认，再清除其他配置的默认标记（保证全列表只有一个默认）。 */
export async function setDefaultModelConfig(paths: WorkspacePaths, id: string) {
  await getModelConfig(paths, id);
  const configs = await listModelConfigs(paths);
  const nextConfigs = configs.map((config) => ({
    ...config,
    isDefault: config.id === id
  }));
  await writeModelConfigs(paths, nextConfigs);
  return nextConfigs;
}

/** 读取模型路由（写作/审稿/规划），文件缺失时返回全空路由。 */
export async function getModelRoutes(paths: WorkspacePaths) {
  return readJsonFile(paths.modelRoutesFile, modelRoutesSchema, defaultRoutes);
}

/** 设置单个用途的路由；传入的模型必须已存在，传 null 表示清除该路由。 */
export async function setModelRoute(paths: WorkspacePaths, routeKey: ModelRouteKey, modelConfigId: string | null) {
  if (modelConfigId) {
    await getModelConfig(paths, modelConfigId);
  }

  const routes = await getModelRoutes(paths);
  const fieldName = `${routeKey}ModelId` as keyof ModelRouteRecord;
  const nextRoutes = {
    ...routes,
    [fieldName]: modelConfigId
  };

  await writeJsonFile(paths.modelRoutesFile, nextRoutes);
  return nextRoutes;
}

/** 配置被删除后，把路由中指向该配置的位置置空。 */
async function removeDeletedConfigFromRoutes(paths: WorkspacePaths, id: string) {
  const routes = await getModelRoutes(paths);
  const nextRoutes: ModelRouteRecord = {
    writingModelId: routes.writingModelId === id ? null : routes.writingModelId,
    reviewModelId: routes.reviewModelId === id ? null : routes.reviewModelId,
    planningModelId: routes.planningModelId === id ? null : routes.planningModelId
  };
  await writeJsonFile(paths.modelRoutesFile, nextRoutes);
}

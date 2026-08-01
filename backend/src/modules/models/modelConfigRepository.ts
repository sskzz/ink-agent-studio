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

const defaultRoutes: ModelRouteRecord = {
  writingModelId: null,
  reviewModelId: null,
  planningModelId: null
};

export async function listModelConfigs(paths: WorkspacePaths) {
  return readJsonFile(paths.modelConfigsFile, modelConfigsIndexSchema, []);
}

export async function getModelConfig(paths: WorkspacePaths, id: string) {
  const configs = await listModelConfigs(paths);
  const config = configs.find((item) => item.id === id);

  if (!config) {
    throw notFound("模型配置不存在", { id });
  }

  return config;
}

async function writeModelConfigs(paths: WorkspacePaths, configs: ModelConfigRecord[]) {
  await writeJsonFile(paths.modelConfigsFile, normalizeDefault(configs));
}

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

export async function getModelRoutes(paths: WorkspacePaths) {
  return readJsonFile(paths.modelRoutesFile, modelRoutesSchema, defaultRoutes);
}

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

async function removeDeletedConfigFromRoutes(paths: WorkspacePaths, id: string) {
  const routes = await getModelRoutes(paths);
  const nextRoutes: ModelRouteRecord = {
    writingModelId: routes.writingModelId === id ? null : routes.writingModelId,
    reviewModelId: routes.reviewModelId === id ? null : routes.reviewModelId,
    planningModelId: routes.planningModelId === id ? null : routes.planningModelId
  };
  await writeJsonFile(paths.modelRoutesFile, nextRoutes);
}

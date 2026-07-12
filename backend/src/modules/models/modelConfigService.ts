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

export function toPublicModelConfig(config: Awaited<ReturnType<typeof getModelConfig>>) {
  return {
    ...config,
    apiKey: ""
  };
}

export async function listPublicModelConfigs(paths: WorkspacePaths) {
  const configs = await listModelConfigs(paths);
  return configs.map((config) => toPublicModelConfig(config));
}

export async function getPublicModelConfig(paths: WorkspacePaths, id: string) {
  return toPublicModelConfig(await getModelConfig(paths, id));
}

export async function savePublicModelConfig(paths: WorkspacePaths, body: unknown) {
  const input = modelConfigUpsertInputSchema.parse(body);
  return toPublicModelConfig(await saveModelConfig(paths, input));
}

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

export async function deletePublicModelConfig(paths: WorkspacePaths, id: string) {
  await deleteModelConfig(paths, id);
  return { id };
}

export async function markPublicDefaultModel(paths: WorkspacePaths, id: string) {
  const configs = await setDefaultModelConfig(paths, id);
  return configs.map((config) => toPublicModelConfig(config));
}

export async function readPublicModelRoutes(paths: WorkspacePaths) {
  return getModelRoutes(paths);
}

export async function updatePublicModelRoute(paths: WorkspacePaths, routeKey: string, body: unknown) {
  const parsedRouteKey = modelRouteKeySchema.parse(routeKey) as ModelRouteKey;
  const input = modelRouteUpdateInputSchema.parse(body);
  return setModelRoute(paths, parsedRouteKey, input.modelConfigId);
}

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
    capabilities: {},
    note: input.note ?? "",
    createdAt: now,
    updatedAt: now
  };

  return testModelConnection(paths, config, input.apiKey ?? "");
}

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

export async function analyzePublicModelSetup(paths: WorkspacePaths) {
  return analyzeModelSetup(paths);
}

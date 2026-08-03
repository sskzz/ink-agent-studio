import { Hono } from "hono";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import {
  analyzePublicModelSetup,
  deletePublicModelConfig,
  discoverPublicModels,
  getPublicModelConfig,
  listPublicModelConfigs,
  markPublicDefaultModel,
  patchPublicModelConfig,
  readPublicModelRoutes,
  savePublicModelConfig,
  testPublicModelConnection,
  updatePublicModelRoute
} from "../modules/models/modelConfigService.js";
import { jsonOk } from "../utils/http.js";

/**
 * 模型配置与路由路由。
 * 覆盖模型配置 CRUD、默认模型、连接测试、模型发现、路由绑定与分析。
 */
export const modelsRoute = new Hono();

/** 使用默认工作区路径。 */
function paths() {
  return createWorkspacePaths();
}

/**
 * GET /api/v1/model-configs：模型配置列表（不返回 apiKey）。
 */
modelsRoute.get("/model-configs", async (context) => {
  const configs = await listPublicModelConfigs(paths());
  return jsonOk(context, configs);
});

/**
 * POST /api/v1/model-configs：新建模型配置，入参校验失败 → 400。
 */
modelsRoute.post("/model-configs", async (context) => {
  const saved = await savePublicModelConfig(paths(), await context.req.json());
  return jsonOk(context, saved, "模型配置已保存", 201);
});

/**
 * GET /api/v1/model-configs/:id：模型配置详情。不存在 → 404。
 */
modelsRoute.get("/model-configs/:id", async (context) => {
  const config = await getPublicModelConfig(paths(), context.req.param("id"));
  return jsonOk(context, config);
});

/**
 * PATCH /api/v1/model-configs/:id：更新模型配置。
 */
modelsRoute.patch("/model-configs/:id", async (context) => {
  const saved = await patchPublicModelConfig(paths(), context.req.param("id"), await context.req.json());
  return jsonOk(context, saved, "模型配置已更新");
});

/**
 * DELETE /api/v1/model-configs/:id：删除模型配置。不存在 → 404。
 */
modelsRoute.delete("/model-configs/:id", async (context) => {
  const deleted = await deletePublicModelConfig(paths(), context.req.param("id"));
  return jsonOk(context, deleted, "模型配置已删除");
});

/**
 * POST /api/v1/model-configs/:id/default：把该配置设为某用途的默认模型。
 */
modelsRoute.post("/model-configs/:id/default", async (context) => {
  const configs = await markPublicDefaultModel(paths(), context.req.param("id"));
  return jsonOk(context, configs, "默认模型已更新");
});

/**
 * POST /api/v1/model-configs/test：测试模型连接（调用远端接口，失败返回可读错误 → 400）。
 */
modelsRoute.post("/model-configs/test", async (context) => {
  const result = await testPublicModelConnection(paths(), await context.req.json());
  return jsonOk(context, result);
});

/**
 * POST /api/v1/model-configs/discover-models：从远端 API 发现可用模型（去重排序后返回）。
 */
modelsRoute.post("/model-configs/discover-models", async (context) => {
  return jsonOk(context, await discoverPublicModels(paths(), await context.req.json()));
});

/**
 * GET /api/v1/model-analysis：模型配置完备性分析（得分与各路由就绪状态）。
 */
modelsRoute.get("/model-analysis", async (context) => {
  return jsonOk(context, await analyzePublicModelSetup(paths()));
});

/**
 * GET /api/v1/model-routes：当前模型路由映射。
 */
modelsRoute.get("/model-routes", async (context) => {
  const routes = await readPublicModelRoutes(paths());
  return jsonOk(context, routes);
});

/**
 * PUT /api/v1/model-routes/:routeKey：绑定路由槽位（routeKey 非法 → 400；modelConfigId 为 null 解绑）。
 */
modelsRoute.put("/model-routes/:routeKey", async (context) => {
  const routes = await updatePublicModelRoute(paths(), context.req.param("routeKey"), await context.req.json());
  return jsonOk(context, routes, "模型路由已更新");
});

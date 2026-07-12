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

export const modelsRoute = new Hono();

function paths() {
  return createWorkspacePaths();
}

modelsRoute.get("/model-configs", async (context) => {
  const configs = await listPublicModelConfigs(paths());
  return jsonOk(context, configs);
});

modelsRoute.post("/model-configs", async (context) => {
  const saved = await savePublicModelConfig(paths(), await context.req.json());
  return jsonOk(context, saved, "模型配置已保存", 201);
});

modelsRoute.get("/model-configs/:id", async (context) => {
  const config = await getPublicModelConfig(paths(), context.req.param("id"));
  return jsonOk(context, config);
});

modelsRoute.patch("/model-configs/:id", async (context) => {
  const saved = await patchPublicModelConfig(paths(), context.req.param("id"), await context.req.json());
  return jsonOk(context, saved, "模型配置已更新");
});

modelsRoute.delete("/model-configs/:id", async (context) => {
  const deleted = await deletePublicModelConfig(paths(), context.req.param("id"));
  return jsonOk(context, deleted, "模型配置已删除");
});

modelsRoute.post("/model-configs/:id/default", async (context) => {
  const configs = await markPublicDefaultModel(paths(), context.req.param("id"));
  return jsonOk(context, configs, "默认模型已更新");
});

modelsRoute.post("/model-configs/test", async (context) => {
  const result = await testPublicModelConnection(paths(), await context.req.json());
  return jsonOk(context, result);
});

modelsRoute.post("/model-configs/discover-models", async (context) => {
  return jsonOk(context, await discoverPublicModels(paths(), await context.req.json()));
});

modelsRoute.get("/model-analysis", async (context) => {
  return jsonOk(context, await analyzePublicModelSetup(paths()));
});

modelsRoute.get("/model-routes", async (context) => {
  const routes = await readPublicModelRoutes(paths());
  return jsonOk(context, routes);
});

modelsRoute.put("/model-routes/:routeKey", async (context) => {
  const routes = await updatePublicModelRoute(paths(), context.req.param("routeKey"), await context.req.json());
  return jsonOk(context, routes, "模型路由已更新");
});

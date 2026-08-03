import { Hono } from "hono";
import {
  getAntiAiConstraintOverview,
  previewEffectiveAntiAiConstraints
} from "../modules/review/antiAi/antiAiService.js";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { jsonOk } from "../utils/http.js";

/**
 * 反 AI 味约束路由。
 * 提供全局规则注册表概览与按作品/场景计算的生效约束预览（只读接口）。
 */
export const antiAiConstraintsRoute = new Hono();

/**
 * GET /api/v1/anti-ai-constraints：全局规则注册表概览（版本号 + 规则列表）。
 */
antiAiConstraintsRoute.get("/anti-ai-constraints", (context) => {
  return jsonOk(context, getAntiAiConstraintOverview());
});

/**
 * GET /api/v1/anti-ai-constraints/effective-preview
 * 按 styleId / sceneType 查询条件预览当前会生效的反 AI 味约束。
 */
antiAiConstraintsRoute.get("/anti-ai-constraints/effective-preview", async (context) => {
  return jsonOk(
    context,
    await previewEffectiveAntiAiConstraints(createWorkspacePaths(), {
      styleId: context.req.query("styleId"),
      sceneType: context.req.query("sceneType")
    })
  );
});


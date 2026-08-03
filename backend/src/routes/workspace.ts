import { Hono } from "hono";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { getWorkspaceSummary } from "../modules/workspace/workspaceService.js";
import { jsonOk } from "../utils/http.js";

/**
 * 工作区路由。
 * GET /api/v1/workspace/ → 工作区概览（版本、数据目录等）。
 */
export const workspaceRoute = new Hono();

/**
 * GET /api/v1/workspace/：返回工作区概要信息，供前端展示数据目录与版本。
 */
workspaceRoute.get("/", async (context) => {
  const paths = createWorkspacePaths();
  const summary = await getWorkspaceSummary(paths);
  return jsonOk(context, summary);
});

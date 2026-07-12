import { Hono } from "hono";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { getWorkspaceSummary } from "../modules/workspace/workspaceService.js";
import { jsonOk } from "../utils/http.js";

export const workspaceRoute = new Hono();

workspaceRoute.get("/", async (context) => {
  const paths = createWorkspacePaths();
  const summary = await getWorkspaceSummary(paths);
  return jsonOk(context, summary);
});

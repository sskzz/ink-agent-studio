import { Hono } from "hono";
import {
  analyzeWritingStyle,
  createWritingStyle,
  listWritingStyles
} from "../modules/styles/writingStyleService.js";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { jsonOk } from "../utils/http.js";

export const writingStylesRoute = new Hono();

function paths() {
  return createWorkspacePaths();
}

writingStylesRoute.get("/writing-styles", async (context) => {
  return jsonOk(context, await listWritingStyles(paths()));
});

writingStylesRoute.post("/writing-styles", async (context) => {
  return jsonOk(context, await createWritingStyle(paths(), await context.req.json()), "写作风格已创建", 201);
});

writingStylesRoute.post("/writing-styles/analyze", async (context) => {
  return jsonOk(context, await analyzeWritingStyle(paths(), await context.req.json()), "写作风格分析完成");
});

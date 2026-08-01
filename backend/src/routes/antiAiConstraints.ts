import { Hono } from "hono";
import {
  getAntiAiConstraintOverview,
  previewEffectiveAntiAiConstraints
} from "../modules/review/antiAi/antiAiService.js";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { jsonOk } from "../utils/http.js";

export const antiAiConstraintsRoute = new Hono();

antiAiConstraintsRoute.get("/anti-ai-constraints", (context) => {
  return jsonOk(context, getAntiAiConstraintOverview());
});

antiAiConstraintsRoute.get("/anti-ai-constraints/effective-preview", async (context) => {
  return jsonOk(
    context,
    await previewEffectiveAntiAiConstraints(createWorkspacePaths(), {
      styleId: context.req.query("styleId"),
      sceneType: context.req.query("sceneType")
    })
  );
});


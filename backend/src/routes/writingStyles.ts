import { Hono } from "hono";
import {
  analyzeWritingStyle,
  createWritingStyle,
  getWritingStyle,
  listWritingStyles
} from "../modules/styles/writingStyleService.js";
import {
  addStyleSample,
  getStyleSample,
  listStyleSamples,
  reanalyzeStyleSample,
  removeStyleSample
} from "../modules/styles/writingStyleSampleService.js";
import {
  activateWritingStyleVersion,
  getStyleVersion,
  listStyleVersions,
  rebuildWritingStyleVersion
} from "../modules/styles/writingStyleVersionService.js";
import { previewWritingStyleConstraint } from "../modules/styles/writingStyleConstraintService.js";
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

writingStylesRoute.get("/writing-styles/:styleId", async (context) => {
  return jsonOk(context, await getWritingStyle(paths(), context.req.param("styleId")));
});

writingStylesRoute.get("/writing-styles/:styleId/samples", async (context) => {
  return jsonOk(context, await listStyleSamples(paths(), context.req.param("styleId")));
});

writingStylesRoute.post("/writing-styles/:styleId/samples", async (context) => {
  return jsonOk(
    context,
    await addStyleSample(paths(), context.req.param("styleId"), await context.req.json()),
    "写作风格样本已添加",
    201
  );
});

writingStylesRoute.get("/writing-styles/:styleId/samples/:sampleId", async (context) => {
  return jsonOk(context, await getStyleSample(paths(), context.req.param("styleId"), context.req.param("sampleId")));
});

writingStylesRoute.delete("/writing-styles/:styleId/samples/:sampleId", async (context) => {
  return jsonOk(context, await removeStyleSample(paths(), context.req.param("styleId"), context.req.param("sampleId")));
});

writingStylesRoute.post("/writing-styles/:styleId/samples/:sampleId/reanalyze", async (context) => {
  return jsonOk(context, await reanalyzeStyleSample(paths(), context.req.param("styleId"), context.req.param("sampleId")), "样本已重新分析");
});

writingStylesRoute.post("/writing-styles/:styleId/rebuild", async (context) => {
  return jsonOk(context, await rebuildWritingStyleVersion(paths(), context.req.param("styleId")), "写作风格新版本已生成");
});

writingStylesRoute.post("/writing-styles/:styleId/constraint-preview", async (context) => {
  return jsonOk(context, await previewWritingStyleConstraint(paths(), context.req.param("styleId"), await context.req.json()));
});

writingStylesRoute.get("/writing-styles/:styleId/versions", async (context) => {
  return jsonOk(context, await listStyleVersions(paths(), context.req.param("styleId")));
});

writingStylesRoute.get("/writing-styles/:styleId/versions/:versionId", async (context) => {
  return jsonOk(context, await getStyleVersion(paths(), context.req.param("styleId"), context.req.param("versionId")));
});

writingStylesRoute.post("/writing-styles/:styleId/versions/:versionId/activate", async (context) => {
  return jsonOk(
    context,
    await activateWritingStyleVersion(paths(), context.req.param("styleId"), context.req.param("versionId")),
    "写作风格版本已激活"
  );
});

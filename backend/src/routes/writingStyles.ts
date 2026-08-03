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

/**
 * 写作风格路由。
 * 覆盖风格 CRUD、样本管理、分析/重建、约束预览与不可变版本管理。
 */
export const writingStylesRoute = new Hono();

/** 使用默认工作区路径。 */
function paths() {
  return createWorkspacePaths();
}

/**
 * GET /api/v1/writing-styles：风格列表。
 */
writingStylesRoute.get("/writing-styles", async (context) => {
  return jsonOk(context, await listWritingStyles(paths()));
});

/**
 * POST /api/v1/writing-styles：新建风格（name 必填，校验失败 → 400）。
 */
writingStylesRoute.post("/writing-styles", async (context) => {
  return jsonOk(context, await createWritingStyle(paths(), await context.req.json()), "写作风格已创建", 201);
});

/**
 * POST /api/v1/writing-styles/analyze：分析样本生成风格画像（content 必填，校验失败 → 400）。
 */
writingStylesRoute.post("/writing-styles/analyze", async (context) => {
  return jsonOk(context, await analyzeWritingStyle(paths(), await context.req.json()), "写作风格分析完成");
});

/**
 * GET /api/v1/writing-styles/:styleId：风格详情。不存在 → 404。
 */
writingStylesRoute.get("/writing-styles/:styleId", async (context) => {
  return jsonOk(context, await getWritingStyle(paths(), context.req.param("styleId")));
});

/**
 * GET /api/v1/writing-styles/:styleId/samples：风格样本列表。
 */
writingStylesRoute.get("/writing-styles/:styleId/samples", async (context) => {
  return jsonOk(context, await listStyleSamples(paths(), context.req.param("styleId")));
});

/**
 * POST /api/v1/writing-styles/:styleId/samples：添加样本（fileName/content 必填 → 400）。
 */
writingStylesRoute.post("/writing-styles/:styleId/samples", async (context) => {
  return jsonOk(
    context,
    await addStyleSample(paths(), context.req.param("styleId"), await context.req.json()),
    "写作风格样本已添加",
    201
  );
});

/**
 * GET /api/v1/writing-styles/:styleId/samples/:sampleId：样本详情。不存在 → 404。
 */
writingStylesRoute.get("/writing-styles/:styleId/samples/:sampleId", async (context) => {
  return jsonOk(context, await getStyleSample(paths(), context.req.param("styleId"), context.req.param("sampleId")));
});

/**
 * DELETE /api/v1/writing-styles/:styleId/samples/:sampleId：删除样本。
 */
writingStylesRoute.delete("/writing-styles/:styleId/samples/:sampleId", async (context) => {
  return jsonOk(context, await removeStyleSample(paths(), context.req.param("styleId"), context.req.param("sampleId")));
});

/**
 * POST /api/v1/writing-styles/:styleId/samples/:sampleId/reanalyze：重新分析单个样本并更新其画像。
 */
writingStylesRoute.post("/writing-styles/:styleId/samples/:sampleId/reanalyze", async (context) => {
  return jsonOk(context, await reanalyzeStyleSample(paths(), context.req.param("styleId"), context.req.param("sampleId")), "样本已重新分析");
});

/**
 * POST /api/v1/writing-styles/:styleId/rebuild：用全部样本重建不可变版本（并发调用幂等）。
 */
writingStylesRoute.post("/writing-styles/:styleId/rebuild", async (context) => {
  return jsonOk(context, await rebuildWritingStyleVersion(paths(), context.req.param("styleId")), "写作风格新版本已生成");
});

/**
 * POST /api/v1/writing-styles/:styleId/constraint-preview：预览该风格编译后的约束（场景过滤）。
 */
writingStylesRoute.post("/writing-styles/:styleId/constraint-preview", async (context) => {
  return jsonOk(context, await previewWritingStyleConstraint(paths(), context.req.param("styleId"), await context.req.json()));
});

/**
 * GET /api/v1/writing-styles/:styleId/versions：版本列表（摘要）。
 */
writingStylesRoute.get("/writing-styles/:styleId/versions", async (context) => {
  return jsonOk(context, await listStyleVersions(paths(), context.req.param("styleId")));
});

/**
 * GET /api/v1/writing-styles/:styleId/versions/:versionId：版本详情。不存在 → 404。
 */
writingStylesRoute.get("/writing-styles/:styleId/versions/:versionId", async (context) => {
  return jsonOk(context, await getStyleVersion(paths(), context.req.param("styleId"), context.req.param("versionId")));
});

/**
 * POST /api/v1/writing-styles/:styleId/versions/:versionId/activate：激活版本（作品可通过 upgrade 固定引用）。
 */
writingStylesRoute.post("/writing-styles/:styleId/versions/:versionId/activate", async (context) => {
  return jsonOk(
    context,
    await activateWritingStyleVersion(paths(), context.req.param("styleId"), context.req.param("versionId")),
    "写作风格版本已激活"
  );
});

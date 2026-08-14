import { Hono } from "hono";
import {
  acceptChapterGeneration,
  continueChapter,
  createChapter,
  deleteChapter,
  getChapter,
  listChapters,
  scheduleChapterStateRebuild,
  updateChapter
} from "../modules/books/chapterService.js";
import type { ApplicationServices } from "../runtime/applicationServices.js";
import { polishChapter, reviewChapter } from "../modules/review/reviewService.js";
import { jsonOk } from "../utils/http.js";

/**
 * 章节路由。
 * 提供章节 CRUD 与 AI 续写 / 审稿 / 润色三个操作接口。
 */
export function createChaptersRoute(services: ApplicationServices) {
const chaptersRoute = new Hono();
const paths = () => services.paths;

/**
 * GET /api/v1/books/:bookId/chapters：章节列表。
 */
chaptersRoute.get("/books/:bookId/chapters", async (context) => {
  return jsonOk(context, await listChapters(paths(), context.req.param("bookId")));
});

/**
 * POST /api/v1/books/:bookId/chapters：新建章节，入参校验失败 → 400。
 */
chaptersRoute.post("/books/:bookId/chapters", async (context) => {
  const bookId = context.req.param("bookId");
  const chapter = await createChapter(paths(), bookId, await context.req.json());
  const observations = chapter.stateSyncStatus === "pending"
    ? await scheduleChapterStateRebuild(paths(), services.runCoordinator, bookId, chapter.chapterNo)
    : [];
  return jsonOk(context, { ...chapter, stateRebuild: observations }, "章节已创建", 201);
});

/**
 * GET /api/v1/books/:bookId/chapters/:chapterId：章节详情（含正文）。不存在 → 404。
 */
chaptersRoute.get("/books/:bookId/chapters/:chapterId", async (context) => {
  return jsonOk(context, await getChapter(paths(), context.req.param("bookId"), context.req.param("chapterId")));
});

/**
 * PUT /api/v1/books/:bookId/chapters/:chapterId：保存章节（标题/大纲/正文全量替换）。
 */
chaptersRoute.put("/books/:bookId/chapters/:chapterId", async (context) => {
  const bookId = context.req.param("bookId");
  const chapterId = context.req.param("chapterId");
  const before = await getChapter(paths(), bookId, chapterId);
  const chapter = await updateChapter(paths(), bookId, chapterId, await context.req.json());
  const observations = chapter.revision !== before.revision
    ? await scheduleChapterStateRebuild(paths(), services.runCoordinator, bookId, chapter.chapterNo)
    : [];
  return jsonOk(
    context,
    { ...chapter, stateRebuild: observations },
    "章节已保存"
  );
});

chaptersRoute.post("/books/:bookId/chapters/:chapterId/accept-generation", async (context) => {
  return jsonOk(context, await acceptChapterGeneration(
    paths(),
    services.runEventStore,
    services.runCoordinator,
    context.req.param("bookId"),
    context.req.param("chapterId"),
    await context.req.json()
  ), "生成结果已采纳，故事线正在更新");
});

/**
 * DELETE /api/v1/books/:bookId/chapters/:chapterId：删除章节（索引与正文文件一并移除，
 * 刷新作品进度；已发布章节拒绝删除）。
 */
chaptersRoute.delete("/books/:bookId/chapters/:chapterId", async (context) => {
  const bookId = context.req.param("bookId");
  const deleted = await deleteChapter(paths(), bookId, context.req.param("chapterId"));
  const observations = await scheduleChapterStateRebuild(paths(), services.runCoordinator, bookId, deleted.chapterNo);
  return jsonOk(
    context,
    { ...deleted, stateRebuild: observations },
    "章节已删除"
  );
});

/**
 * POST /api/v1/books/:bookId/chapters/:chapterId/continue
 * AI 续写章节：同步调用模型并返回生成结果；模型未配置 → 5xx。
 */
chaptersRoute.post("/books/:bookId/chapters/:chapterId/continue", async (context) => {
  return jsonOk(context, await continueChapter(paths(), context.req.param("bookId"), context.req.param("chapterId"), await context.req.json()));
});

/**
 * POST /api/v1/books/:bookId/chapters/:chapterId/review：AI 审稿（风格/连续性/去 AI 味）。
 */
chaptersRoute.post("/books/:bookId/chapters/:chapterId/review", async (context) => {
  return jsonOk(context, await reviewChapter(paths(), context.req.param("bookId"), context.req.param("chapterId"), await context.req.json()));
});

/**
 * POST /api/v1/books/:bookId/chapters/:chapterId/polish：AI 润色（按风格约束修订文本）。
 */
chaptersRoute.post("/books/:bookId/chapters/:chapterId/polish", async (context) => {
  return jsonOk(context, await polishChapter(paths(), context.req.param("bookId"), context.req.param("chapterId"), await context.req.json()));
});

return chaptersRoute;
}

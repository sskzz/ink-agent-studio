import { Hono } from "hono";
import {
  continueChapter,
  createChapter,
  getChapter,
  listChapters,
  updateChapter
} from "../modules/books/chapterService.js";
import { polishChapter, reviewChapter } from "../modules/review/reviewService.js";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { jsonOk } from "../utils/http.js";

export const chaptersRoute = new Hono();

function paths() {
  return createWorkspacePaths();
}

chaptersRoute.get("/books/:bookId/chapters", async (context) => {
  return jsonOk(context, await listChapters(paths(), context.req.param("bookId")));
});

chaptersRoute.post("/books/:bookId/chapters", async (context) => {
  return jsonOk(context, await createChapter(paths(), context.req.param("bookId"), await context.req.json()), "章节已创建", 201);
});

chaptersRoute.get("/books/:bookId/chapters/:chapterId", async (context) => {
  return jsonOk(context, await getChapter(paths(), context.req.param("bookId"), context.req.param("chapterId")));
});

chaptersRoute.put("/books/:bookId/chapters/:chapterId", async (context) => {
  return jsonOk(
    context,
    await updateChapter(paths(), context.req.param("bookId"), context.req.param("chapterId"), await context.req.json()),
    "章节已保存"
  );
});

chaptersRoute.post("/books/:bookId/chapters/:chapterId/continue", async (context) => {
  return jsonOk(context, await continueChapter(paths(), context.req.param("bookId"), context.req.param("chapterId"), await context.req.json()));
});

chaptersRoute.post("/books/:bookId/chapters/:chapterId/review", async (context) => {
  return jsonOk(context, await reviewChapter(paths(), context.req.param("bookId"), context.req.param("chapterId"), await context.req.json()));
});

chaptersRoute.post("/books/:bookId/chapters/:chapterId/polish", async (context) => {
  return jsonOk(context, await polishChapter(paths(), context.req.param("bookId"), context.req.param("chapterId"), await context.req.json()));
});

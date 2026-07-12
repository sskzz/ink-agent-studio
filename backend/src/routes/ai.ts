import { Hono } from "hono";
import { initializeBook } from "../modules/agents/initializeService.js";
import { consistencyCheck } from "../modules/review/reviewService.js";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { jsonOk } from "../utils/http.js";

export const aiRoute = new Hono();

function paths() {
  return createWorkspacePaths();
}

aiRoute.post("/books/:bookId/initialize", async (context) => {
  return jsonOk(context, await initializeBook(paths(), context.req.param("bookId"), await context.req.json()));
});

aiRoute.post("/ai/books/:bookId/consistency-check", async (context) => {
  return jsonOk(context, await consistencyCheck(paths(), context.req.param("bookId"), await context.req.json()));
});

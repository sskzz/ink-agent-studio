import { Hono } from "hono";
import {
  createBook,
  deleteBook,
  getBookDetail,
  listBookSummaries,
  updateBook
} from "../modules/books/bookService.js";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { jsonOk } from "../utils/http.js";

export const booksRoute = new Hono();

function paths() {
  return createWorkspacePaths();
}

booksRoute.get("/books", async (context) => {
  const books = await listBookSummaries(paths());
  return jsonOk(context, books);
});

booksRoute.post("/books", async (context) => {
  const detail = await createBook(paths(), await context.req.json());
  return jsonOk(context, detail, "作品已创建", 201);
});

booksRoute.get("/books/:bookId", async (context) => {
  const detail = await getBookDetail(paths(), context.req.param("bookId"));
  return jsonOk(context, detail);
});

booksRoute.patch("/books/:bookId", async (context) => {
  const detail = await updateBook(paths(), context.req.param("bookId"), await context.req.json());
  return jsonOk(context, detail, "作品已更新");
});

booksRoute.delete("/books/:bookId", async (context) => {
  const deleted = await deleteBook(paths(), context.req.param("bookId"));
  return jsonOk(context, deleted, "作品已删除");
});

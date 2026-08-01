import { Hono } from "hono";
import {
  createBook,
  deleteBook,
  getBookDetail,
  listBookSummaries,
  updateBook,
  upgradeBookWritingStyleVersion
} from "../modules/books/bookService.js";
import { jsonOk } from "../utils/http.js";
import type { ApplicationServices } from "../runtime/applicationServices.js";
import {
  enqueueBookInitialization,
  latestBookInitialization,
  toInitializationDto
} from "./bookInitialization.js";

export function createBooksRoute(services: ApplicationServices) {
  const route = new Hono();

  route.get("/books", async (context) => {
    const books = await listBookSummaries(services.paths);
    return jsonOk(context, books);
  });

  route.post("/books", async (context) => {
    const body = await context.req.json();
    const detail = await createBook(services.paths, body);
    let initialization = null;
    if (services.runtimeDatabase.initialized) {
      try {
        const { run } = await enqueueBookInitialization(services, detail.id, "book_created");
        initialization = toInitializationDto(run);
      } catch (error) {
        try {
          await deleteBook(services.paths, detail.id);
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "AI 初始化入队失败，且新建作品回滚失败"
          );
        }
        throw error;
      }
    }
    return jsonOk(
      context,
      { ...detail, initialization },
      initialization ? "作品已创建，AI 初始化已自动启动" : "作品已创建，AI 初始化尚未启动",
      201
    );
  });

  route.get("/books/:bookId", async (context) => {
    const bookId = context.req.param("bookId");
    const detail = await getBookDetail(services.paths, bookId);
    return jsonOk(context, { ...detail, initialization: latestBookInitialization(services, bookId) });
  });

  route.patch("/books/:bookId", async (context) => {
    const detail = await updateBook(services.paths, context.req.param("bookId"), await context.req.json());
    return jsonOk(context, detail, "作品已更新");
  });

  route.post("/books/:bookId/writing-style/upgrade", async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { versionId?: string | null };
    return jsonOk(
      context,
      await upgradeBookWritingStyleVersion(services.paths, context.req.param("bookId"), body.versionId),
      "作品写作风格版本已升级"
    );
  });

  route.delete("/books/:bookId", async (context) => {
    const bookId = context.req.param("bookId");
    if (services.runtimeDatabase.initialized) {
      for (const run of services.runEventStore.listRuns({ bookId, limit: 20 })) {
        if (run.command.type === "initialize_book" && ["queued", "running", "cancelling"].includes(run.status)) {
          services.runCoordinator.cancel(run.id);
        }
      }
    }
    const deleted = await deleteBook(services.paths, bookId);
    return jsonOk(context, deleted, "作品已删除");
  });

  return route;
}

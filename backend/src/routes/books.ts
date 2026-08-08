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
import { getBookStoryline } from "../modules/books/storylineService.js";
import type { ApplicationServices } from "../runtime/applicationServices.js";
import {
  enqueueBookInitialization,
  latestBookInitialization,
  toInitializationDto
} from "./bookInitialization.js";

/**
 * 作品 CRUD 路由工厂。
 * 创建作品后会自动入队 AI 初始化；删除作品前会先取消该作品未完成的初始化 Run。
 */
export function createBooksRoute(services: ApplicationServices) {
  const route = new Hono();

  /**
   * GET /api/v1/books：作品列表（摘要）。
   */
  route.get("/books", async (context) => {
    const books = await listBookSummaries(services.paths);
    return jsonOk(context, books);
  });

  /**
   * POST /api/v1/books：创建作品（入参校验失败 → 400）。
   * 数据库已初始化时自动入队 AI 初始化；入队失败则回滚删除刚创建的作品，避免残留半成品。
   */
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

  /**
   * GET /api/v1/books/:bookId：作品详情（含最近一次初始化状态）。不存在 → 404。
   */
  route.get("/books/:bookId", async (context) => {
    const bookId = context.req.param("bookId");
    const detail = await getBookDetail(services.paths, bookId);
    return jsonOk(context, { ...detail, initialization: latestBookInitialization(services, bookId) });
  });

  /**
   * GET /api/v1/books/:bookId/storyline：故事线快照（主体/阶段进度、当前位置、短期伏笔、角色状态）。
   */
  route.get("/books/:bookId/storyline", async (context) => {
    const storyline = await getBookStoryline(services.paths, context.req.param("bookId"));
    return jsonOk(context, storyline);
  });

  /**
   * PATCH /api/v1/books/:bookId：更新作品设定。
   */
  route.patch("/books/:bookId", async (context) => {
    const detail = await updateBook(services.paths, context.req.param("bookId"), await context.req.json());
    return jsonOk(context, detail, "作品已更新");
  });

  /**
   * POST /api/v1/books/:bookId/writing-style/upgrade
   * 把作品固定到指定（或最新可用）写作风格版本。body 可省略，缺省升级到最新版本。
   */
  route.post("/books/:bookId/writing-style/upgrade", async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { versionId?: string | null };
    return jsonOk(
      context,
      await upgradeBookWritingStyleVersion(services.paths, context.req.param("bookId"), body.versionId),
      "作品写作风格版本已升级"
    );
  });

  /**
   * DELETE /api/v1/books/:bookId：删除作品。
   * 先取消该作品所有进行中的初始化 Run（避免删除后 Run 继续写已不存在的目录），再删除磁盘数据。
   */
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

import { Hono } from "hono";
import { consistencyCheck } from "../modules/review/reviewService.js";
import { getBook } from "../modules/books/bookRepository.js";
import { jsonOk } from "../utils/http.js";
import type { ApplicationServices } from "../runtime/applicationServices.js";
import { enqueueBookInitialization, toInitializationDto } from "./bookInitialization.js";

/**
 * AI 相关路由工厂。
 * 提供作品 AI 初始化触发与一致性检查接口。
 */
export function createAiRoute(services: ApplicationServices) {
  const route = new Hono();

  /**
   * POST /api/v1/books/:bookId/initialize
   * 触发（或复用）作品 AI 初始化 Run。bookId 不存在 → 404；数据库未初始化 → 503。
   * 返回 202 + 初始化状态（reused 表示复用了已有 Run）。
   */
  route.post("/books/:bookId/initialize", async (context) => {
    const bookId = context.req.param("bookId");
    await getBook(services.paths, bookId);
    const { run, reused } = await enqueueBookInitialization(services, bookId, "manual_retry");
    return jsonOk(
      context,
      { ...toInitializationDto(run), reused },
      reused ? "作品 AI 初始化正在执行" : "作品 AI 初始化已启动",
      202
    );
  });

  /**
   * POST /api/v1/ai/books/:bookId/consistency-check
   * 对作品做一致性检查（设定冲突、事实卡引用等），body 为检查请求，校验失败 → 400。
   */
  route.post("/ai/books/:bookId/consistency-check", async (context) => {
    return jsonOk(
      context,
      await consistencyCheck(services.paths, context.req.param("bookId"), await context.req.json())
    );
  });

  return route;
}

import { Hono } from "hono";
import { consistencyCheck } from "../modules/review/reviewService.js";
import { getBook } from "../modules/books/bookRepository.js";
import { jsonOk } from "../utils/http.js";
import type { ApplicationServices } from "../runtime/applicationServices.js";
import { enqueueBookInitialization, toInitializationDto } from "./bookInitialization.js";

export function createAiRoute(services: ApplicationServices) {
  const route = new Hono();

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

  route.post("/ai/books/:bookId/consistency-check", async (context) => {
    return jsonOk(
      context,
      await consistencyCheck(services.paths, context.req.param("bookId"), await context.req.json())
    );
  });

  return route;
}

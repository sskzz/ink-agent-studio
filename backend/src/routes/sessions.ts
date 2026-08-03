import { Hono } from "hono";
import type { ApplicationServices } from "../runtime/applicationServices.js";
import { badRequest } from "../utils/errors.js";
import { jsonOk } from "../utils/http.js";

/**
 * 会话（Session）路由工厂。
 * 提供会话 CRUD、消息追加、全文搜索与归档接口。
 */
export function createSessionsRoute(services: ApplicationServices) {
  const route = new Hono();

  /**
   * POST /api/v1/sessions/search：全文搜索会话消息（返回带上下文的片段）。
   */
  route.post("/sessions/search", async (context) => {
    return jsonOk(context, await services.sessionService.search(await context.req.json()));
  });

  /**
   * GET /api/v1/sessions：会话列表（可按 bookId 过滤）。
   */
  route.get("/sessions", async (context) => {
    return jsonOk(context, await services.sessionService.list({
      bookId: context.req.query("bookId") || undefined,
      limit: parseLimit(context.req.query("limit"))
    }));
  });

  /**
   * POST /api/v1/sessions：创建会话（校验失败 → 400）。
   */
  route.post("/sessions", async (context) => {
    return jsonOk(context, services.sessionService.create(await context.req.json()), "Session 已创建", 201);
  });

  /**
   * GET /api/v1/sessions/:sessionId：会话详情。不存在 → 404。
   */
  route.get("/sessions/:sessionId", (context) => {
    return jsonOk(context, services.sessionService.get(context.req.param("sessionId")));
  });

  /**
   * POST /api/v1/sessions/:sessionId/archive：归档会话（不再出现在默认列表）。
   */
  route.post("/sessions/:sessionId/archive", (context) => {
    return jsonOk(context, services.sessionService.archive(context.req.param("sessionId")), "Session 已归档");
  });

  /**
   * GET /api/v1/sessions/:sessionId/messages：会话消息列表（按时间升序）。
   */
  route.get("/sessions/:sessionId/messages", async (context) => {
    return jsonOk(context, await services.sessionService.listMessages(
      context.req.param("sessionId"),
      parseLimit(context.req.query("limit"))
    ));
  });

  /**
   * POST /api/v1/sessions/:sessionId/messages：追加消息（role/content 校验失败 → 400）。
   */
  route.post("/sessions/:sessionId/messages", async (context) => {
    return jsonOk(
      context,
      services.sessionService.addMessage(context.req.param("sessionId"), await context.req.json()),
      "消息已保存",
      201
    );
  });

  return route;
}

/**
 * 解析分页 limit：空值返回 undefined（服务端默认），非法值 → 400。
 */
function parseLimit(value: string | undefined) {
  if (value === undefined || value === "") return undefined;
  if (!/^\d+$/.test(value)) throw badRequest("limit 必须是正整数");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000) {
    throw badRequest("limit 必须在 1 到 1000 之间");
  }
  return parsed;
}

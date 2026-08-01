import { Hono } from "hono";
import type { ApplicationServices } from "../runtime/applicationServices.js";
import { badRequest } from "../utils/errors.js";
import { jsonOk } from "../utils/http.js";

export function createSessionsRoute(services: ApplicationServices) {
  const route = new Hono();

  route.post("/sessions/search", async (context) => {
    return jsonOk(context, await services.sessionService.search(await context.req.json()));
  });

  route.get("/sessions", async (context) => {
    return jsonOk(context, await services.sessionService.list({
      bookId: context.req.query("bookId") || undefined,
      limit: parseLimit(context.req.query("limit"))
    }));
  });

  route.post("/sessions", async (context) => {
    return jsonOk(context, services.sessionService.create(await context.req.json()), "Session 已创建", 201);
  });

  route.get("/sessions/:sessionId", (context) => {
    return jsonOk(context, services.sessionService.get(context.req.param("sessionId")));
  });

  route.post("/sessions/:sessionId/archive", (context) => {
    return jsonOk(context, services.sessionService.archive(context.req.param("sessionId")), "Session 已归档");
  });

  route.get("/sessions/:sessionId/messages", async (context) => {
    return jsonOk(context, await services.sessionService.listMessages(
      context.req.param("sessionId"),
      parseLimit(context.req.query("limit"))
    ));
  });

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

function parseLimit(value: string | undefined) {
  if (value === undefined || value === "") return undefined;
  if (!/^\d+$/.test(value)) throw badRequest("limit 必须是正整数");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000) {
    throw badRequest("limit 必须在 1 到 1000 之间");
  }
  return parsed;
}

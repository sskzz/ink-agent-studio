import { Hono } from "hono";
import type { ApplicationServices } from "../runtime/applicationServices.js";
import { jsonOk } from "../utils/http.js";

/**
 * Patch（作品状态修改建议）路由工厂。
 * AI 生成的修改不直接落盘，而是先提出 Patch 等待用户审批，审批通过后才应用。
 */
export function createPatchesRoute(services: ApplicationServices) {
  const route = new Hono();

  /**
   * GET /api/v1/books/:bookId/patches：作品的全部 Patch（按时间倒序）。
   */
  route.get("/books/:bookId/patches", (context) => {
    return jsonOk(context, services.patchService.listByBook(context.req.param("bookId")));
  });

  /**
   * POST /api/v1/runs/:runId/patches：为指定 Run 提议一个 Patch（进入待审批状态）。
   */
  route.post("/runs/:runId/patches", async (context) => {
    const patch = await services.patchService.propose(context.req.param("runId"), await context.req.json());
    return jsonOk(context, patch, "Patch 已生成，等待用户审批", 201);
  });

  /**
   * GET /api/v1/patches/:patchId：Patch 详情。不存在 → 404。
   */
  route.get("/patches/:patchId", (context) => {
    return jsonOk(context, services.patchService.get(context.req.param("patchId")));
  });

  /**
   * POST /api/v1/patches/:patchId/apply：应用 Patch（baseHash 不匹配 → 409）。
   */
  route.post("/patches/:patchId/apply", async (context) => {
    const patch = await services.patchService.apply(context.req.param("patchId"), await context.req.json());
    return jsonOk(context, patch, "Patch 已应用");
  });

  /**
   * POST /api/v1/patches/:patchId/reject：拒绝 Patch（记录拒绝原因）。
   */
  route.post("/patches/:patchId/reject", async (context) => {
    const patch = await services.patchService.reject(context.req.param("patchId"), await context.req.json());
    return jsonOk(context, patch, "Patch 已拒绝");
  });

  return route;
}

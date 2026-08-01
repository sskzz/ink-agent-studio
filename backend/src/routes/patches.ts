import { Hono } from "hono";
import type { ApplicationServices } from "../runtime/applicationServices.js";
import { jsonOk } from "../utils/http.js";

export function createPatchesRoute(services: ApplicationServices) {
  const route = new Hono();

  route.get("/books/:bookId/patches", (context) => {
    return jsonOk(context, services.patchService.listByBook(context.req.param("bookId")));
  });

  route.post("/runs/:runId/patches", async (context) => {
    const patch = await services.patchService.propose(context.req.param("runId"), await context.req.json());
    return jsonOk(context, patch, "Patch 已生成，等待用户审批", 201);
  });

  route.get("/patches/:patchId", (context) => {
    return jsonOk(context, services.patchService.get(context.req.param("patchId")));
  });

  route.post("/patches/:patchId/apply", async (context) => {
    const patch = await services.patchService.apply(context.req.param("patchId"), await context.req.json());
    return jsonOk(context, patch, "Patch 已应用");
  });

  route.post("/patches/:patchId/reject", async (context) => {
    const patch = await services.patchService.reject(context.req.param("patchId"), await context.req.json());
    return jsonOk(context, patch, "Patch 已拒绝");
  });

  return route;
}

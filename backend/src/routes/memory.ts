import {
  userPreferenceApprovalInputSchema,
  userPreferenceArchiveInputSchema,
  userPreferenceProposalInputSchema,
  userPreferenceRejectionInputSchema,
  userPreferenceStatusSchema
} from "@ink-agent/contracts";
import { Hono } from "hono";
import type { ApplicationServices } from "../runtime/applicationServices.js";
import { badRequest } from "../utils/errors.js";
import { jsonOk } from "../utils/http.js";

export function createMemoryRoute(services: ApplicationServices) {
  const route = new Hono();

  route.get("/memory/preferences", async (context) => {
    const statusRaw = context.req.query("status");
    const status = statusRaw ? userPreferenceStatusSchema.parse(statusRaw) : undefined;
    return jsonOk(context, await services.preferenceService.list({ status, limit: parseLimit(context.req.query("limit")) }));
  });
  route.get("/memory/preferences/:preferenceId", (context) =>
    jsonOk(context, services.preferenceService.get(context.req.param("preferenceId")))
  );
  route.post("/memory/preferences/proposals", async (context) => {
    const input = userPreferenceProposalInputSchema.parse(await context.req.json());
    return jsonOk(context, services.preferenceService.propose(input), "偏好记忆提议已创建", 201);
  });
  route.post("/memory/preferences/:preferenceId/approve", async (context) => {
    const input = userPreferenceApprovalInputSchema.parse(await context.req.json());
    return jsonOk(context, await services.preferenceService.approve(context.req.param("preferenceId"), input.approved), "偏好记忆已批准");
  });
  route.post("/memory/preferences/:preferenceId/reject", async (context) => {
    const input = userPreferenceRejectionInputSchema.parse(await context.req.json());
    return jsonOk(context, services.preferenceService.reject(context.req.param("preferenceId"), input.reason), "偏好记忆已拒绝");
  });
  route.post("/memory/preferences/:preferenceId/archive", async (context) => {
    const input = userPreferenceArchiveInputSchema.parse(await context.req.json());
    return jsonOk(context, await services.preferenceService.archive(context.req.param("preferenceId"), input.approved), "偏好记忆已归档");
  });
  route.get("/memory/prompt-preview", async (context) => jsonOk(context, await services.preferenceService.select()));

  return route;
}

function parseLimit(value: string | undefined) {
  if (!value) return undefined;
  if (!/^\d+$/.test(value)) throw badRequest("limit 必须是正整数");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000) throw badRequest("limit 必须在 1 到 1000 之间");
  return parsed;
}

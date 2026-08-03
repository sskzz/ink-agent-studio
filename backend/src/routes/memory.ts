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

/**
 * 偏好记忆（user preference memory）路由工厂。
 * 偏好以“提议 → 批准/拒绝 → 归档”生命周期管理；只有 active 状态的偏好会注入提示词。
 */
export function createMemoryRoute(services: ApplicationServices) {
  const route = new Hono();

  /**
   * GET /api/v1/memory/preferences：偏好列表（可按 status 过滤）。
   */
  route.get("/memory/preferences", async (context) => {
    const statusRaw = context.req.query("status");
    const status = statusRaw ? userPreferenceStatusSchema.parse(statusRaw) : undefined;
    return jsonOk(context, await services.preferenceService.list({ status, limit: parseLimit(context.req.query("limit")) }));
  });
  /**
   * GET /api/v1/memory/preferences/:preferenceId：偏好详情。不存在 → 404。
   */
  route.get("/memory/preferences/:preferenceId", (context) =>
    jsonOk(context, services.preferenceService.get(context.req.param("preferenceId")))
  );
  /**
   * POST /api/v1/memory/preferences/proposals：提出新偏好（内容校验失败 → 400）。
   */
  route.post("/memory/preferences/proposals", async (context) => {
    const input = userPreferenceProposalInputSchema.parse(await context.req.json());
    return jsonOk(context, services.preferenceService.propose(input), "偏好记忆提议已创建", 201);
  });
  /**
   * POST /api/v1/memory/preferences/:preferenceId/approve：批准/驳回提议（approved 必传，否则 400）。
   */
  route.post("/memory/preferences/:preferenceId/approve", async (context) => {
    const input = userPreferenceApprovalInputSchema.parse(await context.req.json());
    return jsonOk(context, await services.preferenceService.approve(context.req.param("preferenceId"), input.approved), "偏好记忆已批准");
  });
  /**
   * POST /api/v1/memory/preferences/:preferenceId/reject：拒绝偏好（reason 必填）。
   */
  route.post("/memory/preferences/:preferenceId/reject", async (context) => {
    const input = userPreferenceRejectionInputSchema.parse(await context.req.json());
    return jsonOk(context, services.preferenceService.reject(context.req.param("preferenceId"), input.reason), "偏好记忆已拒绝");
  });
  /**
   * POST /api/v1/memory/preferences/:preferenceId/archive：归档已批准的偏好。
   */
  route.post("/memory/preferences/:preferenceId/archive", async (context) => {
    const input = userPreferenceArchiveInputSchema.parse(await context.req.json());
    return jsonOk(context, await services.preferenceService.archive(context.req.param("preferenceId"), input.approved), "偏好记忆已归档");
  });
  /**
   * GET /api/v1/memory/prompt-preview：预览当前会注入提示词的偏好段落（调试用）。
   */
  route.get("/memory/prompt-preview", async (context) => jsonOk(context, await services.preferenceService.select()));

  return route;
}

/**
 * 解析分页 limit：空值返回 undefined，非法值 → 400。
 */
function parseLimit(value: string | undefined) {
  if (!value) return undefined;
  if (!/^\d+$/.test(value)) throw badRequest("limit 必须是正整数");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000) throw badRequest("limit 必须在 1 到 1000 之间");
  return parsed;
}

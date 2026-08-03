import {
  novelSkillCreateInputSchema,
  novelSkillPreviewInputSchema,
  novelSkillStatusInputSchema
} from "@ink-agent/contracts";
import { Hono } from "hono";
import type { ApplicationServices } from "../runtime/applicationServices.js";
import { jsonOk } from "../utils/http.js";

/**
 * 技能（Skill）路由工厂。
 * 提供内置/自定义技能列表、预算化选择预览与启停控制。
 */
export function createSkillsRoute(services: ApplicationServices) {
  const route = new Hono();

  /**
   * GET /api/v1/skills：技能列表（内置 + 自定义）。
   */
  route.get("/skills", async (context) => jsonOk(context, await services.skillService.list()));
  /**
   * GET /api/v1/skills/:skillId：技能详情。不存在 → 404。
   */
  route.get("/skills/:skillId", async (context) => jsonOk(context, await services.skillService.get(context.req.param("skillId"))));
  /**
   * POST /api/v1/skills/preview：按指令与预算预览技能选择结果（含生成的 prompt）。
   */
  route.post("/skills/preview", async (context) => {
    const input = novelSkillPreviewInputSchema.parse(await context.req.json());
    const config = await services.configService.get();
    return jsonOk(context, await services.skillService.select(input, config));
  });
  /**
   * POST /api/v1/skills：创建自定义技能（入参校验失败 → 400）。
   */
  route.post("/skills", async (context) => {
    const input = novelSkillCreateInputSchema.parse(await context.req.json());
    const config = await services.configService.get();
    return jsonOk(context, await services.skillService.create(input, config), "自定义技能已创建", 201);
  });
  /**
   * POST /api/v1/skills/:skillId/status：启用/停用技能（需要审批时按 approved 判定）。
   */
  route.post("/skills/:skillId/status", async (context) => {
    const input = novelSkillStatusInputSchema.parse(await context.req.json());
    const config = await services.configService.get();
    return jsonOk(
      context,
      await services.skillService.setEnabled(context.req.param("skillId"), input.enabled, input.approved, config),
      "技能状态已更新"
    );
  });

  return route;
}

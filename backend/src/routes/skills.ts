import {
  novelSkillCreateInputSchema,
  novelSkillPreviewInputSchema,
  novelSkillStatusInputSchema
} from "@ink-agent/contracts";
import { Hono } from "hono";
import type { ApplicationServices } from "../runtime/applicationServices.js";
import { jsonOk } from "../utils/http.js";

export function createSkillsRoute(services: ApplicationServices) {
  const route = new Hono();

  route.get("/skills", async (context) => jsonOk(context, await services.skillService.list()));
  route.get("/skills/:skillId", async (context) => jsonOk(context, await services.skillService.get(context.req.param("skillId"))));
  route.post("/skills/preview", async (context) => {
    const input = novelSkillPreviewInputSchema.parse(await context.req.json());
    const config = await services.configService.get();
    return jsonOk(context, await services.skillService.select(input, config));
  });
  route.post("/skills", async (context) => {
    const input = novelSkillCreateInputSchema.parse(await context.req.json());
    const config = await services.configService.get();
    return jsonOk(context, await services.skillService.create(input, config), "自定义技能已创建", 201);
  });
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

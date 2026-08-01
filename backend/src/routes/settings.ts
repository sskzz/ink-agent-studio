import { Hono } from "hono";
import type { ConfigService } from "../config/configService.js";
import { jsonOk } from "../utils/http.js";

export function createSettingsRoute(configService: ConfigService) {
  const route = new Hono();

  route.get("/settings", async (context) => {
    return jsonOk(context, await configService.getEffective());
  });

  route.patch("/settings", async (context) => {
    return jsonOk(context, await configService.update(await context.req.json()), "配置已保存");
  });

  route.post("/settings/validate", async (context) => {
    const body = (await context.req.json()) as { changes?: unknown };
    return jsonOk(context, await configService.validate(body.changes ?? {}), "配置校验通过");
  });

  route.post("/settings/reset-section", async (context) => {
    const body = (await context.req.json()) as { section?: string; expectedRevision?: number };
    return jsonOk(
      context,
      await configService.resetSection(body.section ?? "", body.expectedRevision ?? 0),
      "配置分区已恢复默认值"
    );
  });

  route.post("/settings/reload", async (context) => {
    return jsonOk(context, await configService.reload(), "配置已重新加载");
  });

  return route;
}

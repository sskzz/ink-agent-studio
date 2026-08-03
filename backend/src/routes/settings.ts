import { Hono } from "hono";
import type { ConfigService } from "../config/configService.js";
import { jsonOk } from "../utils/http.js";

/**
 * 公共设置路由工厂。
 * 提供配置读取、乐观锁更新、预校验、分区重置与热重载接口。
 */
export function createSettingsRoute(configService: ConfigService) {
  const route = new Hono();

  /**
   * GET /api/v1/settings：生效配置（含 revision 与 configHash）。
   */
  route.get("/settings", async (context) => {
    return jsonOk(context, await configService.getEffective());
  });

  /**
   * PATCH /api/v1/settings：更新配置（revision 不匹配 → 409，校验失败 → 400）。
   */
  route.patch("/settings", async (context) => {
    return jsonOk(context, await configService.update(await context.req.json()), "配置已保存");
  });

  /**
   * POST /api/v1/settings/validate：预校验变更而不落盘，返回应用后的配置投影。
   */
  route.post("/settings/validate", async (context) => {
    const body = (await context.req.json()) as { changes?: unknown };
    return jsonOk(context, await configService.validate(body.changes ?? {}), "配置校验通过");
  });

  /**
   * POST /api/v1/settings/reset-section：把指定分区恢复默认值（未知分区 → 400）。
   */
  route.post("/settings/reset-section", async (context) => {
    const body = (await context.req.json()) as { section?: string; expectedRevision?: number };
    return jsonOk(
      context,
      await configService.resetSection(body.section ?? "", body.expectedRevision ?? 0),
      "配置分区已恢复默认值"
    );
  });

  /**
   * POST /api/v1/settings/reload：从磁盘重新加载配置（用户手工编辑后热生效）。
   */
  route.post("/settings/reload", async (context) => {
    return jsonOk(context, await configService.reload(), "配置已重新加载");
  });

  return route;
}

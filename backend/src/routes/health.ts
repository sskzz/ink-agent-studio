import { Hono } from "hono";
import { jsonOk } from "../utils/http.js";

export const healthRoute = new Hono();

/**
 * 健康检查接口。
 * 前端启动脚本和后续桌面端都可以用它判断后端是否已经准备好。
 */
healthRoute.get("/", (context) =>
  jsonOk(context, {
    service: "ink-agent-backend",
    status: "ok",
    time: new Date().toISOString()
  })
);

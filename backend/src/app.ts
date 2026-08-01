import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAiRoute } from "./routes/ai.js";
import { createBooksRoute } from "./routes/books.js";
import { chaptersRoute } from "./routes/chapters.js";
import { entitiesRoute } from "./routes/entities.js";
import { filesRoute } from "./routes/files.js";
import { healthRoute } from "./routes/health.js";
import { modelsRoute } from "./routes/models.js";
import { createRunsRoute } from "./routes/runs.js";
import { workspaceRoute } from "./routes/workspace.js";
import { writingStylesRoute } from "./routes/writingStyles.js";
import { antiAiConstraintsRoute } from "./routes/antiAiConstraints.js";
import { toAppError } from "./utils/errors.js";
import { jsonError } from "./utils/http.js";
import { createApplicationServices, type ApplicationServices } from "./runtime/applicationServices.js";
import { createSettingsRoute } from "./routes/settings.js";
import { createPatchesRoute } from "./routes/patches.js";
import { createSessionsRoute } from "./routes/sessions.js";
import { createSkillsRoute } from "./routes/skills.js";
import { createMemoryRoute } from "./routes/memory.js";

const localOriginPattern = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/;

function getExtraAllowedOrigins() {
  return (process.env.INK_AGENT_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function resolveCorsOrigin(origin: string) {
  if (!origin) {
    return undefined;
  }

  // Vite 开发端口可能从 5173 漂移到 5174、5175 等，本地优先项目允许本机来源访问后端。
  if (localOriginPattern.test(origin)) {
    return origin;
  }

  return getExtraAllowedOrigins().includes(origin) ? origin : undefined;
}

/**
 * 创建 Hono 应用实例。
 * 这里只负责框架级能力：CORS、错误处理、路由注册；业务逻辑必须放到 modules 中。
 */
export function createApp(services: ApplicationServices = createApplicationServices()) {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: resolveCorsOrigin,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      credentials: false
    })
  );

  app.route("/api/v1/health", healthRoute);
  app.route("/api/v1/workspace", workspaceRoute);
  app.route("/api/v1", createAiRoute(services));
  app.route("/api/v1", createBooksRoute(services));
  app.route("/api/v1", chaptersRoute);
  app.route("/api/v1", entitiesRoute);
  app.route("/api/v1", filesRoute);
  app.route("/api/v1", modelsRoute);
  app.route("/api/v1", createRunsRoute(services));
  app.route("/api/v1", createPatchesRoute(services));
  app.route("/api/v1", createSessionsRoute(services));
  app.route("/api/v1", createSkillsRoute(services));
  app.route("/api/v1", createMemoryRoute(services));
  app.route("/api/v1", writingStylesRoute);
  app.route("/api/v1", antiAiConstraintsRoute);
  app.route("/api/v1", createSettingsRoute(services.configService));

  app.notFound((context) => jsonError(context, 14040, "接口不存在", 404));

  app.onError((error, context) => {
    const appError = toAppError(error);
    return jsonError(context, appError.code, appError.message, appError.status, appError.details);
  });

  return app;
}

import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createWorkspacePaths } from "./modules/workspace/workspacePaths.js";
import { ensureWorkspace } from "./modules/workspace/workspaceService.js";

const port = Number(process.env.PORT ?? 8787);

/**
 * 后端启动入口。
 * 启动 HTTP 服务前先初始化本地工作区，避免接口第一次读写时目录不存在。
 */
async function bootstrap() {
  const workspacePaths = createWorkspacePaths();
  await ensureWorkspace(workspacePaths);

  const app = createApp();

  serve(
    {
      fetch: app.fetch,
      port,
      hostname: "127.0.0.1"
    },
    () => {
      console.log(`Ink Agent Backend 已启动：http://127.0.0.1:${port}`);
      console.log(`本地数据目录：${workspacePaths.root}`);
    }
  );
}

void bootstrap().catch((error) => {
  console.error("Ink Agent Backend 启动失败：", error);
  process.exit(1);
});

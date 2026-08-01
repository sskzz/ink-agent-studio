import "dotenv/config";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ensureWorkspace } from "./modules/workspace/workspaceService.js";
import { createApplicationServices } from "./runtime/applicationServices.js";
import { registerGracefulShutdown } from "./runtime/gracefulShutdown.js";

const port = Number(process.env.PORT ?? 8787);

/**
 * 后端启动入口。
 * 启动 HTTP 服务前先初始化本地工作区，避免接口第一次读写时目录不存在。
 */
async function bootstrap() {
  const services = createApplicationServices();
  await ensureWorkspace(services.paths);
  await services.workspaceLease.acquire();

  try {
    const config = await services.configService.initialize();
    const databaseInitialization = await services.runtimeDatabase.initialize({
      busyTimeoutMs: config.storage.sqliteBusyTimeoutMs,
      backupBeforeMigration: config.storage.backupBeforeMigration
    });
    const legacyImport = await services.legacyRunImporter.import();
    await services.patchService.recoverIncompleteApplications();
    const runRecovery = await services.runCoordinator.recoverAndResumeRequiredWorkflows();
    const app = createApp(services);
    const server = serve(
      {
        fetch: app.fetch,
        port,
        hostname: "127.0.0.1"
      },
      () => {
        console.log(`Ink Agent Backend 已启动：http://127.0.0.1:${port}`);
        console.log(`本地数据目录：${services.paths.root}`);
        if (databaseInitialization.appliedMigrations.length > 0) {
          console.log(`运行数据库迁移：${databaseInitialization.appliedMigrations.map((item) => `v${item.version}`).join(", ")}`);
        }
        if (legacyImport.imported > 0 || legacyImport.invalid > 0) {
          console.log(`旧 Run 导入：${legacyImport.imported} 条，异常 ${legacyImport.invalid} 条`);
        }
        if (runRecovery.interrupted > 0) {
          console.log(`恢复检查：${runRecovery.interrupted} 个未完成 Run 已标记为 interrupted`);
        }
        if (runRecovery.resumedRunIds.length > 0) {
          console.log(`自动恢复：${runRecovery.resumedRunIds.length} 个作品初始化 Run 已重新入队`);
        }
        if (runRecovery.failures.length > 0) {
          console.error("自动恢复失败：", runRecovery.failures);
        }
      }
    );

    registerGracefulShutdown(server, services);
  } catch (error) {
    services.runtimeDatabase.close();
    await services.workspaceLease.release();
    throw error;
  }
}

void bootstrap().catch((error) => {
  console.error("Ink Agent Backend 启动失败：", error);
  process.exit(1);
});

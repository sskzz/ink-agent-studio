import "dotenv/config";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ensureWorkspace } from "./modules/workspace/workspaceService.js";
import { createApplicationServices } from "./runtime/applicationServices.js";
import { registerGracefulShutdown } from "./runtime/gracefulShutdown.js";

/**
 * 后端进程入口。
 * 启动顺序：加载环境变量 → 建工作区目录 → 获取工作区写锁 → 初始化配置/数据库 →
 * 导入旧 Run 数据并恢复未完成任务 → 启动 HTTP 服务 → 注册优雅关闭。
 * 任何一步失败都会释放已获取的资源（数据库、锁）后以非零码退出。
 */
const port = Number(process.env.PORT ?? 8787);

/**
 * 启动引导流程。
 * 数据库初始化前先取工作区写锁，保证迁移期间没有第二个进程写同一数据目录。
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
    // 启动期一次性的恢复工作：导入旧 JSONL Run、回收中断的补丁应用、恢复未完成的流程。
    const legacyImport = await services.legacyRunImporter.import();
    await services.patchService.recoverIncompleteApplications();
    const runRecovery = await services.runCoordinator.recoverAndResumeRequiredWorkflows();
    const chapterObservationRecovery = await services.runCoordinator.recoverChapterStateObservations(services.paths);
    const app = createApp(services);
    const server = serve(
      {
        fetch: app.fetch,
        port,
        // 只监听本机回环地址：桌面端与前端开发服务器同机访问，不对外网暴露。
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
          console.log(`自动恢复：${runRecovery.resumedRunIds.length} 个必要工作流 Run 已重新入队`);
        }
        if (runRecovery.failures.length > 0) {
          console.error("自动恢复失败：", runRecovery.failures);
        }
        if (chapterObservationRecovery.resumedRunIds.length > 0) {
          console.log(`自动恢复：${chapterObservationRecovery.resumedRunIds.length} 个章节状态观察 Run 已重新入队`);
        }
        if (chapterObservationRecovery.failures.length > 0) {
          console.error("章节状态观察恢复失败：", chapterObservationRecovery.failures);
        }
      }
    );

    registerGracefulShutdown(server, services);
  } catch (error) {
    // 启动失败清理：关数据库并释放锁，避免锁文件残留阻止下次启动。
    services.runtimeDatabase.close();
    await services.workspaceLease.release();
    throw error;
  }
}

void bootstrap().catch((error) => {
  console.error("Ink Agent Backend 启动失败：", error);
  process.exit(1);
});

import type { ServerType } from "@hono/node-server";
import type { ApplicationServices } from "./applicationServices.js";

/**
 * 注册优雅关闭。
 * 收到 SIGINT/SIGTERM 时按顺序执行：停接新请求 → 等待 Run 协调器把进行中的任务收尾 → 关闭数据库 → 释放工作区锁。
 */

/**
 * 注册信号处理并返回 shutdown 函数。
 * 关闭顺序不能颠倒：先停服务器，再以配置的宽限期让 Run 收尾，最后释放资源；
 * 关闭失败也会走完 finally，避免锁文件残留导致下次无法启动。
 */
export function registerGracefulShutdown(server: ServerType, services: ApplicationServices) {
  let shuttingDown = false;

  // 关闭主流程：shuttingDown 防重入，保证第二次信号不会并发执行清理。
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    try {
      // 先关闭 HTTP server，不再接受新请求。
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    } finally {
      try {
        // 给进行中的 Run 一个宽限期收尾（如标记 interrupted 以便下次恢复）。
        const config = await services.configService.get();
        await services.runCoordinator.shutdown(config.runtime.shutdownGraceMs);
      } finally {
        // 无论协调器是否成功，都要关数据库并释放工作区锁。
        services.runtimeDatabase.close();
        await services.workspaceLease.release();
      }
    }
  };

  // 信号回调：失败也要设置退出码，但不再阻塞后续清理。
  const handleSignal = () => {
    void shutdown().catch((error) => {
      console.error("Ink Agent Backend 关闭失败：", error);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);
  return shutdown;
}

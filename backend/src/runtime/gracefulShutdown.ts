import type { ServerType } from "@hono/node-server";
import type { ApplicationServices } from "./applicationServices.js";

export function registerGracefulShutdown(server: ServerType, services: ApplicationServices) {
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    try {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    } finally {
      try {
        const config = await services.configService.get();
        await services.runCoordinator.shutdown(config.runtime.shutdownGraceMs);
      } finally {
        services.runtimeDatabase.close();
        await services.workspaceLease.release();
      }
    }
  };

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

/**
 * Prompt 记忆选择（兼容层）。
 * 职责：为单次 Prompt 组装临时打开 SQLite 连接，经 PreferenceService 选出当前生效的用户偏好文本；
 * 边界：短生命周期连接、用完即关；BookState 等作品状态仍只从 JSON/Markdown 读取，不进 SQLite。
 */
import type { AppConfig } from "@ink-agent/contracts";
import { RuntimeDatabase } from "../../runtime/database/runtimeDatabase.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { PreferenceRepository } from "./preferenceRepository.js";
import { PreferenceService } from "./preferenceService.js";

/**
 * 现有同步章节 API 不持有 ApplicationServices。这里为单次 Prompt 选择打开短生命周期的
 * SQLite 连接，使旧 API 保持兼容；BookState 仍只从 JSON/Markdown 读取。
 * @returns 用户偏好记忆的组装提示（含来源追踪）
 */
export async function selectPromptMemory(paths: WorkspacePaths, config: AppConfig) {
  const runtimeDatabase = new RuntimeDatabase(paths);
  try {
    await runtimeDatabase.initialize({
      busyTimeoutMs: config.storage.sqliteBusyTimeoutMs,
      backupBeforeMigration: config.storage.backupBeforeMigration
    });
    const service = new PreferenceService(
      new PreferenceRepository(runtimeDatabase),
      { async get() { return config; } }
    );
    return await service.select(config);
  } finally {
    runtimeDatabase.close();
  }
}

import { appConfigSchema, type AppConfig } from "@ink-agent/contracts";
import { AppError } from "../utils/errors.js";
import { pathExists, readTextFile } from "../utils/fileStore.js";
import { writeJsonFile } from "../utils/jsonStore.js";
import type { WorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { defaultAppConfig } from "./defaultAppConfig.js";

/**
 * 公共配置文件（app-config.json）的读写仓储。
 * 只负责与文件系统交互：首次运行生成默认配置，读取时校验，写入时再次校验。
 */

/**
 * 构造配置文件损坏错误（500）。
 * 配置文件损坏时拒绝静默覆盖，宁可让服务启动失败，也不丢失用户手工编辑的内容。
 */
function invalidConfig(message: string, details?: unknown) {
  return new AppError(message, { code: 15010, status: 500, details });
}

/**
 * 公共配置仓储：管理 app-config.json 的读取与写入。
 */
export class ConfigRepository {
  constructor(private readonly paths: WorkspacePaths) {}

  /**
   * 读取配置；文件不存在时写入并返回默认配置。
   * 空文件、非法 JSON、校验失败都会抛 invalidConfig 而不是用默认值覆盖，防止用户手改被静默丢弃。
   */
  async readOrCreate(): Promise<AppConfig> {
    if (!(await pathExists(this.paths.appConfigFile))) {
      await this.write(defaultAppConfig);
      return structuredClone(defaultAppConfig);
    }

    const raw = await readTextFile(this.paths.appConfigFile);

    if (!raw.trim()) {
      throw invalidConfig("公共配置文件为空，已拒绝用默认值覆盖", { file: this.paths.appConfigFile });
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw invalidConfig("公共配置文件不是合法 JSON，原文件未被修改", {
        file: this.paths.appConfigFile,
        message: error instanceof Error ? error.message : String(error)
      });
    }

    const result = appConfigSchema.safeParse(parsed);

    if (!result.success) {
      throw invalidConfig("公共配置文件校验失败，原文件未被修改", {
        file: this.paths.appConfigFile,
        issues: result.error.issues
      });
    }

    return result.data;
  }

  /**
   * 写入配置：写入前用 schema 完整校验，保证落盘内容永远合法。
   */
  async write(config: AppConfig) {
    const validated = appConfigSchema.parse(config);
    await writeJsonFile(this.paths.appConfigFile, validated);
    return validated;
  }
}

import { appConfigSchema, type AppConfig } from "@ink-agent/contracts";
import { AppError } from "../utils/errors.js";
import { pathExists, readTextFile } from "../utils/fileStore.js";
import { writeJsonFile } from "../utils/jsonStore.js";
import type { WorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { defaultAppConfig } from "./defaultAppConfig.js";

function invalidConfig(message: string, details?: unknown) {
  return new AppError(message, { code: 15010, status: 500, details });
}

export class ConfigRepository {
  constructor(private readonly paths: WorkspacePaths) {}

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

  async write(config: AppConfig) {
    const validated = appConfigSchema.parse(config);
    await writeJsonFile(this.paths.appConfigFile, validated);
    return validated;
  }
}

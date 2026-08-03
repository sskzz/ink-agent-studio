import type { AppConfig, EffectiveConfigResponse } from "@ink-agent/contracts";
import { sha256 } from "../utils/hash.js";

/**
 * 配置投影工具。
 * 把内部 AppConfig 投影成对外暴露的 EffectiveConfigResponse，并标记需要重启才生效的字段。
 */

/** 修改后必须重启进程才能生效的配置字段（deep path 列表）。 */
const restartRequiredFields = [
  "storage.sqliteBusyTimeoutMs",
  "plugins.enabled",
  "mcp.enabled",
  "cron.enabled"
];

/**
 * 投影当前生效配置。
 * configHash 由完整配置序列化得到，前端可据此判断配置是否变化；返回深拷贝防止外部篡改内存态。
 */
export function projectEffectiveConfig(config: AppConfig): EffectiveConfigResponse {
  return {
    effectiveConfig: structuredClone(config),
    revision: config.revision,
    configHash: sha256(JSON.stringify(config)),
    sources: {},
    lockedFields: [],
    restartRequiredFields
  };
}

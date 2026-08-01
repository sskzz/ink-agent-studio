import type { AppConfig, EffectiveConfigResponse } from "@ink-agent/contracts";
import { sha256 } from "../utils/hash.js";

const restartRequiredFields = [
  "storage.sqliteBusyTimeoutMs",
  "plugins.enabled",
  "mcp.enabled",
  "cron.enabled"
];

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

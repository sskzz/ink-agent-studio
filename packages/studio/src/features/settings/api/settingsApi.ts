/**
 * 本地设置 API：读取生效配置、增量更新、预校验与重载。
 * 设置以 patch 形式提交，后端负责与默认值合并，前端无需理解配置全量结构。
 */
import type { AppConfigPatch, EffectiveConfigResponse } from "@ink-agent/contracts";
import { apiGet, apiPatch, apiPost } from "@/shared/api/http";

/** 读取当前生效配置（默认值 + 本地覆盖合并后的结果）。 */
export function getSettings() {
  return apiGet<EffectiveConfigResponse>("/settings");
}

/** 增量更新设置：只提交变化项，后端合并并返回新的生效配置。 */
export function updateSettings(input: AppConfigPatch) {
  return apiPatch<EffectiveConfigResponse>("/settings", input);
}

/** 预校验设置改动：不落盘，用于“保存前先验证”的交互。 */
export function validateSettings(changes: AppConfigPatch["changes"]) {
  return apiPost<EffectiveConfigResponse>("/settings/validate", { changes });
}

/** 从磁盘重载配置：放弃未保存改动，恢复到上次持久化状态。 */
export function reloadSettings() {
  return apiPost<EffectiveConfigResponse>("/settings/reload", {});
}

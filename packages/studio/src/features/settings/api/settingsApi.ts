import type { AppConfigPatch, EffectiveConfigResponse } from "@ink-agent/contracts";
import { apiGet, apiPatch, apiPost } from "@/shared/api/http";

export function getSettings() {
  return apiGet<EffectiveConfigResponse>("/settings");
}

export function updateSettings(input: AppConfigPatch) {
  return apiPatch<EffectiveConfigResponse>("/settings", input);
}

export function validateSettings(changes: AppConfigPatch["changes"]) {
  return apiPost<EffectiveConfigResponse>("/settings/validate", { changes });
}

export function reloadSettings() {
  return apiPost<EffectiveConfigResponse>("/settings/reload", {});
}

/**
 * 偏好记忆 API：用户偏好的提案、审批、拒绝、归档与提示词预览。
 * 契约类型取自 @ink-agent/contracts，审批动作直接落后端，前端不做本地缓存。
 */
import type {
  UserMemorySelection,
  UserPreference,
  UserPreferenceProposalInput
} from "@ink-agent/contracts";
import { apiGet, apiPost } from "./http";

/** 偏好列表：可按状态过滤（如只看待审批的提案）。 */
export function listPreferences(status?: UserPreference["status"]) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiGet<UserPreference[]>(`/memory/preferences${query}`);
}

/** 提交一条新的偏好提案，进入待审批队列。 */
export function proposePreference(input: UserPreferenceProposalInput) {
  return apiPost<UserPreference>("/memory/preferences/proposals", input);
}

/** 审批通过一条偏好：通过后才会进入实际提示词注入。 */
export function approvePreference(preferenceId: string) {
  return apiPost<UserPreference>(`/memory/preferences/${preferenceId}/approve`, { approved: true });
}

/** 拒绝一条偏好提案：reason 会被记录用于后续复盘。 */
export function rejectPreference(preferenceId: string, reason: string) {
  return apiPost<UserPreference>(`/memory/preferences/${preferenceId}/reject`, { reason });
}

/** 归档一条已处理偏好：从主列表移除但保留历史记录。 */
export function archivePreference(preferenceId: string) {
  return apiPost<UserPreference>(`/memory/preferences/${preferenceId}/archive`, { approved: true });
}

/** 预览最终注入系统提示词的内容：展示所有已审批偏好如何进入上下文。 */
export function previewMemoryPrompt() {
  return apiGet<UserMemorySelection>("/memory/prompt-preview");
}

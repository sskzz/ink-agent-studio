import type {
  UserMemorySelection,
  UserPreference,
  UserPreferenceProposalInput
} from "@ink-agent/contracts";
import { apiGet, apiPost } from "./http";

export function listPreferences(status?: UserPreference["status"]) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiGet<UserPreference[]>(`/memory/preferences${query}`);
}

export function proposePreference(input: UserPreferenceProposalInput) {
  return apiPost<UserPreference>("/memory/preferences/proposals", input);
}

export function approvePreference(preferenceId: string) {
  return apiPost<UserPreference>(`/memory/preferences/${preferenceId}/approve`, { approved: true });
}

export function rejectPreference(preferenceId: string, reason: string) {
  return apiPost<UserPreference>(`/memory/preferences/${preferenceId}/reject`, { reason });
}

export function archivePreference(preferenceId: string) {
  return apiPost<UserPreference>(`/memory/preferences/${preferenceId}/archive`, { approved: true });
}

export function previewMemoryPrompt() {
  return apiGet<UserMemorySelection>("/memory/prompt-preview");
}

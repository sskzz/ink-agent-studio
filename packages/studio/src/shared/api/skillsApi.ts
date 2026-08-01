import type { NovelSkillDetail, NovelSkillMetadata, NovelSkillSelection } from "@ink-agent/contracts";
import { apiGet, apiPost } from "./http";

export function listSkills() {
  return apiGet<NovelSkillMetadata[]>("/skills");
}

export function getSkill(skillId: string) {
  return apiGet<NovelSkillDetail>(`/skills/${skillId}`);
}

export function previewSkills(input: {
  operation: "planning" | "writing" | "review";
  instruction?: string;
  context?: string;
  requestedSkillIds?: string[];
}) {
  return apiPost<NovelSkillSelection>("/skills/preview", input);
}

export function setSkillEnabled(skillId: string, enabled: boolean) {
  return apiPost<NovelSkillMetadata>(`/skills/${skillId}/status`, { enabled, approved: true });
}

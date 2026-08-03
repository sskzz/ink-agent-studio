/**
 * 小说技能 API：技能列表、详情、按任务预览技能选择与启用状态切换。
 * 契约类型统一取自 @ink-agent/contracts 包，前端不重复声明。
 */
import type { NovelSkillDetail, NovelSkillMetadata, NovelSkillSelection } from "@ink-agent/contracts";
import { apiGet, apiPost } from "./http";

/** 技能列表：用于技能管理页展示全部可用技能。 */
export function listSkills() {
  return apiGet<NovelSkillMetadata[]>("/skills");
}

/** 单个技能详情：含完整技能定义与启用状态。 */
export function getSkill(skillId: string) {
  return apiGet<NovelSkillDetail>(`/skills/${skillId}`);
}

/** 预览技能选择：给定任务类型与上下文，由后端模拟渐进加载后返回应启用的技能集。 */
export function previewSkills(input: {
  operation: "planning" | "writing" | "review";
  instruction?: string;
  context?: string;
  requestedSkillIds?: string[];
}) {
  return apiPost<NovelSkillSelection>("/skills/preview", input);
}

/** 启用/停用技能：enabled=false 时同时视为已审批，避免停用后仍处于待审批态。 */
export function setSkillEnabled(skillId: string, enabled: boolean) {
  return apiPost<NovelSkillMetadata>(`/skills/${skillId}/status`, { enabled, approved: true });
}

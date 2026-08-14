import type { StoryPlanChapter } from "../../schemas/storyKnowledgeSchemas.js";
import type { BookEntityRecord } from "../../types/domain.js";
import { readCharacterProfile } from "../books/storyKnowledgeRepository.js";

/**
 * 章节生成前的人物一致性硬闸门。
 * 这是确定性兜底：对已锁定的“禁止行为/硬约束”进行可解释的文本匹配；更细的人设表达
 * 则由五层档案进入 Prompt 约束，避免把自然语言人物塑造成过度刚性的误杀规则。
 */
export function validatePlannedCharacterConsistency(
  chapter: StoryPlanChapter | null | undefined,
  entities: BookEntityRecord[]
): string[] {
  if (!chapter) return [];
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const issues: string[] = [];
  for (const action of chapter.dimensions.characterActions) {
    const entity = entityById.get(action.characterId);
    if (!entity || entity.entityType !== "character") {
      issues.push(`第 ${chapter.chapterNo} 章角色行为引用的不是已知角色：${action.characterId}`);
      continue;
    }
    const profile = readCharacterProfile(entity);
    if (!profile) continue;
    for (const prohibited of profile.core.prohibitedActions) {
      if (normalized(action.action).includes(normalized(prohibited))) {
        issues.push(`第 ${chapter.chapterNo} 章中「${entity.name}」的行为「${action.action}」违反已锁定禁止行为「${prohibited}」`);
      }
    }
    for (const constraint of profile.core.hardConstraints) {
      const [marker, forbidden] = constraint.split(/[:：]/, 2).map((value) => value.trim());
      // “不得/不能/禁止：X” 才作为硬性否定约束解析，其余文本只保留给 Prompt 进行软约束。
      if (/^(不得|不能|禁止)/.test(marker) && forbidden && normalized(action.action).includes(normalized(forbidden))) {
        issues.push(`第 ${chapter.chapterNo} 章中「${entity.name}」的行为「${action.action}」违反硬约束「${constraint}」`);
      }
    }
  }
  return issues;
}

function normalized(value: string) {
  return value.replace(/[\s，。！？、；："'（）【】《》]/g, "").toLowerCase();
}

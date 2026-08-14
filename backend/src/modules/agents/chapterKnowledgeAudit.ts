import type { RuntimeForeshadowing } from "../../schemas/runtimeStateSchemas.js";
import type {
  StoryPlanChapter,
  WorldRuleRegistry
} from "../../schemas/storyKnowledgeSchemas.js";
import type { BookEntityRecord } from "../../types/domain.js";
import { readCharacterProfile } from "../books/storyKnowledgeRepository.js";
import { scheduleForeshadowing } from "../books/foreshadowingScheduler.js";

export type ChapterKnowledgeAuditIssueCode =
  | "CHARACTER_REFERENCE_MISSING"
  | "CHARACTER_PROHIBITED_ACTION"
  | "CHARACTER_HARD_CONSTRAINT"
  | "CHARACTER_FORBIDDEN_EXPRESSION"
  | "LOCKED_TERM_ALIAS"
  | "IMMUTABLE_WORLD_RULE_CONFLICT"
  | "FORCED_FORESHADOWING_MISSED";

export interface ChapterKnowledgeAuditIssue {
  code: ChapterKnowledgeAuditIssueCode;
  message: string;
  sourceId: string;
  evidence?: string;
}

export interface ChapterKnowledgeAuditWarning {
  code: "PLANNED_CHARACTER_NOT_EVIDENCED";
  message: string;
  sourceId: string;
}

export interface ChapterKnowledgeAuditReport {
  schemaVersion: "chapter-knowledge-audit.v1";
  passed: boolean;
  blockingIssues: ChapterKnowledgeAuditIssue[];
  warnings: ChapterKnowledgeAuditWarning[];
}

export interface ChapterKnowledgeAuditInput {
  content: string;
  chapterNo: number;
  plannedChapter: StoryPlanChapter | null;
  terms: Array<{
    id: string;
    term: string;
    aliases: string[];
    locked: boolean;
  }>;
  entities: BookEntityRecord[];
  worldRules: WorldRuleRegistry | null;
  foreshadowing: RuntimeForeshadowing[];
}

/**
 * 生成后的零 Token 确定性知识审核。
 * 只把有明确文本证据的冲突设为阻断项；章纲覆盖等需要语义理解的弱信号只告警，
 * 避免把自然语言中的转述、代词和隐喻当成硬错误。
 */
export function auditChapterKnowledge(input: ChapterKnowledgeAuditInput): ChapterKnowledgeAuditReport {
  const blockingIssues = deduplicateIssues([
    ...auditCharacters(input),
    ...auditLockedTerms(input),
    ...auditWorldRules(input),
    ...auditForcedForeshadowing(input)
  ]);
  const warnings = auditPlannedCharacterCoverage(input);
  return {
    schemaVersion: "chapter-knowledge-audit.v1",
    passed: blockingIssues.length === 0,
    blockingIssues,
    warnings
  };
}

function auditCharacters(input: ChapterKnowledgeAuditInput): ChapterKnowledgeAuditIssue[] {
  const issues: ChapterKnowledgeAuditIssue[] = [];
  const plannedCharacterIds = new Set(input.plannedChapter?.dimensions.characterActions.map((item) => item.characterId) ?? []);
  const entityById = new Map(input.entities.map((entity) => [entity.id, entity]));

  for (const characterId of plannedCharacterIds) {
    const entity = entityById.get(characterId);
    if (!entity || entity.entityType !== "character") {
      issues.push({
        code: "CHARACTER_REFERENCE_MISSING",
        sourceId: characterId,
        message: `第 ${input.chapterNo} 章章纲引用的角色已不存在：${characterId}`
      });
    }
  }

  const segments = splitEvidenceSegments(input.content);
  for (const entity of input.entities) {
    const profile = readCharacterProfile(entity);
    if (!profile) continue;
    const names = characterNames(entity);
    const relatedSegments = segments.filter((segment) => names.some((name) => includesText(segment, name)));
    if (relatedSegments.length === 0) continue;

    for (const prohibited of profile.core.prohibitedActions) {
      const evidence = relatedSegments.find((segment) => includesNormalized(segment, prohibited));
      if (!evidence) continue;
      issues.push({
        code: "CHARACTER_PROHIBITED_ACTION",
        sourceId: entity.id,
        message: `「${entity.name}」触发已锁定禁止行为「${prohibited}」`,
        evidence: compactEvidence(evidence)
      });
    }

    for (const constraint of profile.core.hardConstraints) {
      const forbidden = parseExplicitForbiddenPhrase(constraint);
      if (!forbidden) continue;
      const evidence = relatedSegments.find((segment) => includesNormalized(segment, forbidden));
      if (!evidence) continue;
      issues.push({
        code: "CHARACTER_HARD_CONSTRAINT",
        sourceId: entity.id,
        message: `「${entity.name}」违反人物硬约束「${constraint}」`,
        evidence: compactEvidence(evidence)
      });
    }

    for (const expression of profile.dialogueDna.forbiddenExpressions) {
      const evidence = relatedSegments.find((segment) => hasDialogueMarker(segment) && includesNormalized(segment, expression));
      if (!evidence) continue;
      issues.push({
        code: "CHARACTER_FORBIDDEN_EXPRESSION",
        sourceId: entity.id,
        message: `「${entity.name}」的对白使用禁用表达「${expression}」`,
        evidence: compactEvidence(evidence)
      });
    }
  }
  return issues;
}

function auditLockedTerms(input: ChapterKnowledgeAuditInput): ChapterKnowledgeAuditIssue[] {
  if (!input.plannedChapter) return [];
  const lockedIds = new Set(input.plannedChapter.lockedTermIds);
  return input.terms
    .filter((term) => term.locked && lockedIds.has(term.id))
    .flatMap((term) => {
      const withoutCanonical = removeAll(input.content, term.term);
      return term.aliases.flatMap((alias): ChapterKnowledgeAuditIssue[] => {
        if (normalize(alias) === normalize(term.term) || !includesText(withoutCanonical, alias)) return [];
        return [{
          code: "LOCKED_TERM_ALIAS",
          sourceId: term.id,
          message: `锁定专名「${term.term}」被写成别名「${alias}」`,
          evidence: excerptAround(input.content, alias)
        }];
      });
    });
}

function auditWorldRules(input: ChapterKnowledgeAuditInput): ChapterKnowledgeAuditIssue[] {
  if (!input.worldRules) return [];
  return input.worldRules.rules
    .filter((rule) => rule.status === "active" && rule.mutability === "immutable")
    .flatMap((rule) => {
      const explicitPhrases = [
        ...rule.prohibitedExpressions,
        ...extractExplicitForbiddenPhrases(rule.content)
      ];
      return explicitPhrases.flatMap((phrase): ChapterKnowledgeAuditIssue[] => {
        if (!includesNormalized(input.content, phrase)) return [];
        return [{
          code: "IMMUTABLE_WORLD_RULE_CONFLICT",
          sourceId: rule.id,
          message: `正文触发不可变世界规则「${rule.title}」的禁用表达「${phrase}」`,
          evidence: excerptAround(input.content, phrase)
        }];
      });
    });
}

function auditForcedForeshadowing(input: ChapterKnowledgeAuditInput): ChapterKnowledgeAuditIssue[] {
  return scheduleForeshadowing(input.foreshadowing, input.chapterNo)
    .filter((item) => item.forceRecovery)
    .flatMap((item): ChapterKnowledgeAuditIssue[] => {
      if (hasForeshadowingEvidence(input.content, item)) return [];
      return [{
        code: "FORCED_FORESHADOWING_MISSED",
        sourceId: item.id,
        message: `逾期伏笔「${item.content}」已连续漏处理 ${item.missedCount} 次，本章仍无明确回收证据`
      }];
    });
}

function auditPlannedCharacterCoverage(input: ChapterKnowledgeAuditInput): ChapterKnowledgeAuditWarning[] {
  if (!input.plannedChapter) return [];
  const entityById = new Map(input.entities.map((entity) => [entity.id, entity]));
  const characterIds = new Set(input.plannedChapter.dimensions.characterActions.map((item) => item.characterId));
  return [...characterIds].flatMap((characterId): ChapterKnowledgeAuditWarning[] => {
    const entity = entityById.get(characterId);
    if (!entity || characterNames(entity).some((name) => includesText(input.content, name))) return [];
    return [{
      code: "PLANNED_CHARACTER_NOT_EVIDENCED",
      sourceId: characterId,
      message: `章纲安排角色「${entity.name}」行动，但正文未检出其姓名；如使用代词或隐式视角请人工确认`
    }];
  });
}

function hasForeshadowingEvidence(content: string, item: RuntimeForeshadowing) {
  if (includesText(content, item.id)) return true;
  const candidates = [item.content, item.resolution]
    .flatMap((value) => [value, ...value.split(/[，。！？、；：,.!?;:]/u)])
    .map((value) => normalizeForeshadowingEvidence(value))
    .filter((value) => value.length >= 4);
  const normalizedContent = normalize(content);
  return candidates.some((candidate) => normalizedContent.includes(candidate) || ngramCoverage(candidate, normalizedContent) >= 0.65);
}

function normalizeForeshadowingEvidence(value: string) {
  return normalize(value)
    .replace(/第\d+(?:至|-|~|到)?\d*章/gu, "")
    .replace(/(?:揭示|回收|发现|说明|表明|伏笔|最终|真相)/gu, "");
}

function ngramCoverage(candidate: string, content: string) {
  const grams = new Set<string>();
  for (let index = 0; index < candidate.length - 1; index += 1) grams.add(candidate.slice(index, index + 2));
  if (grams.size < 3) return 0;
  let hits = 0;
  for (const gram of grams) if (content.includes(gram)) hits += 1;
  return hits / grams.size;
}

function characterNames(entity: BookEntityRecord) {
  const aliases = Array.isArray(entity.attributes.aliases)
    ? entity.attributes.aliases.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  return [entity.name, ...aliases];
}

function parseExplicitForbiddenPhrase(value: string) {
  const match = /^(?:不得|不能|禁止)(?:[^:：]{0,12})?[:：]\s*(.+)$/u.exec(value.trim());
  return match?.[1]?.trim() || null;
}

function extractExplicitForbiddenPhrases(value: string) {
  return value.split(/[。；;\n]/u)
    .map((part) => parseExplicitForbiddenPhrase(part))
    .filter((part): part is string => Boolean(part));
}

function splitEvidenceSegments(content: string) {
  return content.split(/(?<=[。！？!?；;\n])/u).map((segment) => segment.trim()).filter(Boolean);
}

function hasDialogueMarker(value: string) {
  return /[“”「」『』"]/u.test(value);
}

function includesText(haystack: string, needle: string) {
  return haystack.toLocaleLowerCase().includes(needle.trim().toLocaleLowerCase());
}

function includesNormalized(haystack: string, needle: string) {
  const normalizedNeedle = normalize(needle);
  return normalizedNeedle.length > 0 && normalize(haystack).includes(normalizedNeedle);
}

function normalize(value: string) {
  return value.replace(/[\s，。！？、；："'（）【】《》“”「」『』,.!?;:()\[\]<>]/gu, "").toLocaleLowerCase();
}

function removeAll(content: string, value: string) {
  if (!value.trim()) return content;
  return content.replaceAll(value, " ");
}

function excerptAround(content: string, needle: string) {
  const index = content.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (index < 0) return undefined;
  return compactEvidence(content.slice(Math.max(0, index - 45), index + needle.length + 45));
}

function compactEvidence(value: string) {
  const compacted = value.replace(/\s+/g, " ").trim();
  return Array.from(compacted).slice(0, 180).join("");
}

function deduplicateIssues(issues: ChapterKnowledgeAuditIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.sourceId}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

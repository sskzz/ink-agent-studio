import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/shared/api/http";

export interface StoryPlanChapter {
  chapterNo: number;
  volumeNo: number;
  title: string;
  dimensions: {
    synopsis: string;
    characterActions: Array<{ characterId: string; action: string; expectedState?: string }>;
    scenes: string[];
    conflicts: string[];
    narrativeGoals: string[];
  };
  lockedTermIds: string[];
  status: "draft" | "reviewing" | "approved" | "blocked";
  reviewNotes: string[];
}

export interface StoryPlan {
  schemaVersion: "story-plan.v1";
  bookId: string;
  mainLine: string;
  plannedChapterCount: number;
  terms: Array<{ id: string; term: string; aliases: string[]; category: string; locked: boolean; note: string }>;
  volumes: Array<{
    id: string;
    volumeNo: number;
    title: string;
    chapterRange: { start: number; end: number };
    objective: string;
    conflict: string;
    turningPoint: string;
    climax: string;
    resolution: string;
    characterChanges: string[];
  }>;
  batches: Array<{
    id: string;
    batchNo: number;
    chapterRange: { start: number; end: number };
    status: "draft" | "generating" | "reviewing" | "approved" | "blocked";
    qualityGate: {
      passed: boolean;
      checkedAt: string;
      blockingIssues: string[];
      warnings: string[];
      repairAttempts: number;
    } | null;
  }>;
  chapters: StoryPlanChapter[];
  updatedAt: string;
}

export interface CharacterProfile {
  schemaVersion: "character-profile.v1";
  core: {
    appearance: string;
    personalityTraits: string[];
    motivations: string[];
    values: string[];
    hardConstraints: string[];
    prohibitedActions: string[];
  };
  arc: {
    startState: string;
    targetState: string;
    milestones: Array<{ chapterRange: { start: number; end: number }; change: string }>;
  };
  timeline: { currentState: string; knownHistory: string[] };
  relationships: Array<{
    targetCharacterId: string;
    relation: string;
    tension: string;
    allowedDirection: string;
  }>;
  dialogueDna: {
    voice: string;
    sentenceRhythm: string;
    signaturePhrases: string[];
    forbiddenExpressions: string[];
    subtextHabits: string[];
  };
}

export interface CharacterEntity {
  id: string;
  bookId: string;
  entityType: "character";
  name: string;
  role: string;
  description: string;
  attributes: Record<string, unknown> & { profile?: CharacterProfile };
  updatedAt: string;
}

export interface WorldRuleRegistry {
  schemaVersion: "world-rule-registry.v1";
  bookId: string;
  rules: Array<{
    id: string;
    title: string;
    content: string;
    category: "law" | "setting" | "history" | "story_fact";
    mutability: "immutable" | "mutable";
    prohibitedExpressions: string[];
    status: "active" | "superseded" | "archived";
    source: "initialization" | "user" | "chapter-observer";
    sourceChapterNo: number | null;
    evidence: string;
    updatedAt: string;
  }>;
  proposals: Array<{
    id: string;
    kind: "new_fact" | "rule_update";
    title: string;
    content: string;
    evidence: string;
    targetRuleId?: string | null;
    chapterNo: number;
    status: "applied" | "proposed" | "rejected";
    reason: string;
    createdAt: string;
  }>;
  updatedAt: string;
}

export interface ForeshadowingItem {
  id: string;
  content: string;
  relatedEntityIds: string[];
  placement: string;
  resolution: string;
  horizon?: "short" | "long";
  targetChapterRange?: { start: number; end: number } | null;
  status: "planned" | "planted" | "advancing" | "resolving" | "resolved" | "archived";
  scheduleStatus?: "on_track" | "due" | "overdue";
  missedCount?: number;
  lastAdvancedChapter: number | null;
}

export interface StoryPlanRunAccepted {
  runId: string;
  status: "queued" | "running" | "cancelling";
  reused: boolean;
  eventsUrl: string;
  acceptedAt: string;
}

export interface LegacyKnowledgeBackfillProposal {
  schemaVersion: "legacy-knowledge-backfill.v1";
  id: string;
  bookId: string;
  status: "proposed" | "applied" | "superseded";
  sourceHash: string;
  storyPlan: StoryPlan | null;
  worldRules: WorldRuleRegistry | null;
  characterProfiles: Array<{ entityId: string; characterName: string; profile: CharacterProfile }>;
  decisions: Array<{
    itemKey: string;
    status: "pending" | "accepted" | "rejected";
    editedValue?: unknown;
    reason: string;
    reviewedAt: string | null;
  }>;
  warnings: string[];
  createdAt: string;
  appliedAt: string | null;
}

export interface LegacyKnowledgeBackfillPreview {
  proposalId: string;
  sourceHash: string;
  authorityHash: string;
  ready: boolean;
  counts: { accepted: number; rejected: number; pending: number; willCreate: number; skipped: number };
  items: Array<{
    itemKey: string;
    status: "pending" | "accepted" | "rejected";
    outcome: "will_create" | "skip_existing" | "skip_rejected" | "pending" | "missing_target";
  }>;
}

export function getStoryPlan(bookId: string) {
  return apiGet<StoryPlan>(`/books/${bookId}/story-plan`);
}

export function generateStoryPlanBatch(bookId: string, batchNo: number) {
  return apiPost<StoryPlanRunAccepted>(`/books/${bookId}/story-plan/batches/${batchNo}/generate`);
}

export function listCharacters(bookId: string) {
  return apiGet<CharacterEntity[]>(`/books/${bookId}/entities?type=character`);
}

export function updateCharacterProfile(bookId: string, character: CharacterEntity, profile: CharacterProfile) {
  return apiPut<CharacterEntity>(`/books/${bookId}/characters/${character.id}/profile`, profile);
}

export function updateStoryPlanMainLine(bookId: string, mainLine: string) {
  return apiPut<StoryPlan>(`/books/${bookId}/story-plan/main-line`, { mainLine });
}

export function upsertLockedTerm(bookId: string, term: StoryPlan["terms"][number], exists = false) {
  return exists
    ? apiPatch<StoryPlan>(`/books/${bookId}/story-plan/terms/${term.id}`, term)
    : apiPost<StoryPlan>(`/books/${bookId}/story-plan/terms`, term);
}

export function deleteLockedTerm(bookId: string, termId: string) {
  return apiDelete<StoryPlan>(`/books/${bookId}/story-plan/terms/${termId}`);
}

export function updateStoryPlanVolume(bookId: string, volume: StoryPlan["volumes"][number]) {
  return apiPatch<StoryPlan>(`/books/${bookId}/story-plan/volumes/${volume.volumeNo}`, volume);
}

export function upsertStoryPlanChapter(bookId: string, chapter: StoryPlanChapter) {
  return apiPut<StoryPlan>(`/books/${bookId}/story-plan/chapters/${chapter.chapterNo}`, chapter);
}

export function deleteStoryPlanChapter(bookId: string, chapterNo: number) {
  return apiDelete<StoryPlan>(`/books/${bookId}/story-plan/chapters/${chapterNo}`);
}

export function reauditStoryPlanBatch(bookId: string, batchNo: number) {
  return apiPost<StoryPlan>(`/books/${bookId}/story-plan/batches/${batchNo}/audit`);
}

export function getWorldRules(bookId: string) {
  return apiGet<WorldRuleRegistry | null>(`/books/${bookId}/world-rules`);
}

export function reviewWorldRuleProposal(bookId: string, proposalId: string, approved: boolean, reason = "") {
  return apiPost<WorldRuleRegistry>(`/books/${bookId}/world-rules/proposals/${proposalId}/review`, {
    approved,
    reason
  });
}

export type WorldRule = WorldRuleRegistry["rules"][number];

export function upsertWorldRule(bookId: string, rule: WorldRule, exists = false) {
  const input = {
    id: rule.id,
    title: rule.title,
    content: rule.content,
    category: rule.category,
    mutability: rule.mutability,
    prohibitedExpressions: rule.prohibitedExpressions,
    evidence: rule.evidence
  };
  return exists
    ? apiPatch<WorldRuleRegistry>(`/books/${bookId}/world-rules/${rule.id}`, input)
    : apiPost<WorldRuleRegistry>(`/books/${bookId}/world-rules`, input);
}

export function archiveWorldRule(bookId: string, ruleId: string) {
  return apiPost<WorldRuleRegistry>(`/books/${bookId}/world-rules/${ruleId}/archive`);
}

export function listForeshadowing(bookId: string) {
  return apiGet<ForeshadowingItem[]>(`/books/${bookId}/foreshadowing`);
}

export function upsertForeshadowing(bookId: string, item: ForeshadowingItem, exists = false) {
  return exists
    ? apiPatch<ForeshadowingItem>(`/books/${bookId}/foreshadowing/${item.id}`, item)
    : apiPost<ForeshadowingItem>(`/books/${bookId}/foreshadowing`, item);
}

export function advanceForeshadowing(bookId: string, itemId: string, status: ForeshadowingItem["status"], lastAdvancedChapter?: number | null) {
  return apiPost<ForeshadowingItem>(`/books/${bookId}/foreshadowing/${itemId}/advance`, { status, lastAdvancedChapter });
}

export function archiveForeshadowing(bookId: string, itemId: string) {
  return apiPost<ForeshadowingItem>(`/books/${bookId}/foreshadowing/${itemId}/archive`);
}

export function getLegacyKnowledgeBackfill(bookId: string) {
  return apiGet<LegacyKnowledgeBackfillProposal | null>(`/books/${bookId}/knowledge-backfill`);
}

export function proposeLegacyKnowledgeBackfill(bookId: string) {
  return apiPost<LegacyKnowledgeBackfillProposal>(`/books/${bookId}/knowledge-backfill/propose`);
}

export function applyLegacyKnowledgeBackfill(bookId: string, proposalId: string) {
  return apiPost<{ proposal: LegacyKnowledgeBackfillProposal; applied: { storyPlan: boolean; worldRules: boolean; worldRuleCount: number; characterProfiles: number }; snapshotPath: string; preview: LegacyKnowledgeBackfillPreview }>(
    `/books/${bookId}/knowledge-backfill/${proposalId}/apply`
  );
}

export function reviewLegacyKnowledgeBackfillItem(
  bookId: string,
  proposalId: string,
  itemKey: string,
  input: { status: "pending" | "accepted" | "rejected"; editedValue?: unknown; reason?: string }
) {
  return apiPatch<LegacyKnowledgeBackfillProposal>(
    `/books/${bookId}/knowledge-backfill/${proposalId}/items/${encodeURIComponent(itemKey)}`,
    input
  );
}

export function previewLegacyKnowledgeBackfillApply(bookId: string, proposalId: string) {
  return apiGet<LegacyKnowledgeBackfillPreview>(`/books/${bookId}/knowledge-backfill/${proposalId}/preview`);
}

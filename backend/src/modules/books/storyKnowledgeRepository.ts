import {
  characterProfileSchema,
  storyPlanSchema,
  worldRuleRegistrySchema,
  type CharacterProfile,
  type StoryPlan,
  type StoryPlanChapter,
  type WorldRuleProposal,
  type WorldRuleRegistry
} from "../../schemas/storyKnowledgeSchemas.js";
import type { BookEntityRecord } from "../../types/domain.js";
import { pathExists } from "../../utils/fileStore.js";
import { sha256 } from "../../utils/hash.js";
import { readJsonFile, writeJsonFile } from "../../utils/jsonStore.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { createBookPaths } from "./bookPaths.js";

const BATCH_SIZE = 20;

export interface InitialStoryPlanInput {
  mainLine: string;
  estimatedChapters: number;
  volumes: Array<{
    title: string;
    goal: string;
    conflict: string;
    turningPoint: string;
    climax: string;
    resolution: string;
    characterChanges: string[];
  }>;
  terms: Array<{
    id: string;
    term: string;
    category: "character" | "faction" | "location" | "item" | "rule" | "event" | "custom";
    aliases?: string[];
    note?: string;
  }>;
}

/** 初始化三层大纲的书级、卷级和批次索引；章级内容按 20 章批次延迟生成。 */
export function createInitialStoryPlan(bookId: string, input: InitialStoryPlanInput, now = new Date().toISOString()): StoryPlan {
  const plannedChapterCount = Math.min(1_000, Math.max(50, input.estimatedChapters));
  const volumeCount = Math.max(1, input.volumes.length);
  let previousEnd = 0;
  const volumes = input.volumes.map((volume, index) => {
    const end = index === volumeCount - 1
      ? plannedChapterCount
      : Math.max(previousEnd + 1, Math.round(((index + 1) / volumeCount) * plannedChapterCount));
    const result = {
      id: `volume-${String(index + 1).padStart(2, "0")}`,
      volumeNo: index + 1,
      title: volume.title,
      chapterRange: { start: previousEnd + 1, end },
      objective: volume.goal,
      conflict: volume.conflict,
      turningPoint: volume.turningPoint,
      climax: volume.climax,
      resolution: volume.resolution,
      characterChanges: volume.characterChanges
    };
    previousEnd = end;
    return result;
  });
  // 批次必须在单卷内切分；跨卷批次会让一次模型调用同时受两套卷目标约束，质量闸门也无法判断归属。
  const batchRanges = volumes.flatMap((volume) => {
    const ranges: Array<{ start: number; end: number }> = [];
    for (let start = volume.chapterRange.start; start <= volume.chapterRange.end; start += BATCH_SIZE) {
      ranges.push({ start, end: Math.min(volume.chapterRange.end, start + BATCH_SIZE - 1) });
    }
    return ranges;
  });
  const batches = batchRanges.map((chapterRange, index) => ({
    id: `batch-${String(index + 1).padStart(2, "0")}`,
    batchNo: index + 1,
    chapterRange,
    status: "draft" as const,
    qualityGate: null
  }));
  return storyPlanSchema.parse({
    schemaVersion: "story-plan.v1",
    bookId,
    mainLine: input.mainLine,
    plannedChapterCount,
    terms: input.terms.map((term) => ({ ...term, aliases: term.aliases ?? [], locked: true, note: term.note ?? "" })),
    volumes,
    batches,
    chapters: [],
    createdAt: now,
    updatedAt: now
  });
}

export async function readStoryPlan(paths: WorkspacePaths, bookId: string): Promise<StoryPlan | null> {
  const filePath = createBookPaths(paths, bookId).storyPlanFile;
  if (!(await pathExists(filePath))) return null;
  return readJsonFile(filePath, storyPlanSchema, null as never).catch(() => null);
}

export async function writeStoryPlan(paths: WorkspacePaths, bookId: string, plan: StoryPlan): Promise<void> {
  await writeJsonFile(createBookPaths(paths, bookId).storyPlanFile, storyPlanSchema.parse(plan));
}

/** 章纲批次闸门：检查范围覆盖、五维完整、实体/专名引用和跨章承接。 */
export function auditStoryPlanBatch(
  plan: StoryPlan,
  chapters: StoryPlanChapter[],
  knownEntityIds: Set<string>
): { passed: boolean; blockingIssues: string[]; warnings: string[] } {
  const blockingIssues: string[] = [];
  const warnings: string[] = [];
  const batch = plan.batches.find((item) => chapters.some((chapter) =>
    chapter.chapterNo >= item.chapterRange.start && chapter.chapterNo <= item.chapterRange.end
  ));
  if (!batch) return { passed: false, blockingIssues: ["章纲不属于任何已规划批次"], warnings };
  const expected = Array.from(
    { length: batch.chapterRange.end - batch.chapterRange.start + 1 },
    (_, index) => batch.chapterRange.start + index
  );
  const actual = new Set(chapters.map((chapter) => chapter.chapterNo));
  const outsideRange = chapters.filter((chapter) =>
    chapter.chapterNo < batch.chapterRange.start || chapter.chapterNo > batch.chapterRange.end
  );
  if (outsideRange.length > 0) {
    blockingIssues.push(`批次包含范围外章节：${outsideRange.map((chapter) => chapter.chapterNo).join("、")}`);
  }
  for (const chapterNo of expected) {
    if (!actual.has(chapterNo)) blockingIssues.push(`缺少第 ${chapterNo} 章细纲`);
  }
  if (actual.size !== chapters.length) blockingIssues.push("批次内存在重复章节号");

  const termIds = new Set(plan.terms.map((term) => term.id));
  const ordered = [...chapters].sort((left, right) => left.chapterNo - right.chapterNo);
  for (const chapter of ordered) {
    const volume = plan.volumes.find((item) => chapter.chapterNo >= item.chapterRange.start && chapter.chapterNo <= item.chapterRange.end);
    if (!volume || volume.volumeNo !== chapter.volumeNo) {
      blockingIssues.push(`第 ${chapter.chapterNo} 章卷号与卷级范围不一致`);
    }
    for (const action of chapter.dimensions.characterActions) {
      if (!knownEntityIds.has(action.characterId)) blockingIssues.push(`第 ${chapter.chapterNo} 章引用未知角色 ${action.characterId}`);
    }
    for (const termId of chapter.lockedTermIds) {
      if (!termIds.has(termId)) blockingIssues.push(`第 ${chapter.chapterNo} 章引用未知专名 ${termId}`);
    }
    if (chapter.dimensions.synopsis.length < 12) warnings.push(`第 ${chapter.chapterNo} 章梗概过短`);
    if (chapter.dimensions.scenes.length < 2) warnings.push(`第 ${chapter.chapterNo} 章场景少于 2 个`);
    if (chapter.dimensions.narrativeGoals.length === 0) blockingIssues.push(`第 ${chapter.chapterNo} 章缺少叙事目标`);
  }
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (current.chapterNo !== previous.chapterNo + 1) continue;
    const previousActors = new Set(previous.dimensions.characterActions.map((item) => item.characterId));
    const currentActors = current.dimensions.characterActions.map((item) => item.characterId);
    if (!currentActors.some((id) => previousActors.has(id))) {
      warnings.push(`第 ${previous.chapterNo}-${current.chapterNo} 章缺少显式角色承接，请审核转场是否合理`);
    }
  }
  return { passed: blockingIssues.length === 0, blockingIssues, warnings };
}

/** 合并通过闸门的章纲批次。未通过时批次标为 blocked，不污染已批准章节。 */
export function mergeStoryPlanBatch(plan: StoryPlan, batchNo: number, chapters: StoryPlanChapter[], repairAttempts: number, knownEntityIds: Set<string>): StoryPlan {
  const batch = plan.batches.find((item) => item.batchNo === batchNo);
  if (!batch) throw new Error(`大纲批次不存在：${batchNo}`);
  const audit = auditStoryPlanBatch(plan, chapters, knownEntityIds);
  const now = new Date().toISOString();
  const chapterNos = new Set(chapters.map((chapter) => chapter.chapterNo));
  return storyPlanSchema.parse({
    ...plan,
    chapters: audit.passed
      ? [...plan.chapters.filter((chapter) => !chapterNos.has(chapter.chapterNo)), ...chapters.map((chapter) => ({ ...chapter, status: "approved", reviewNotes: audit.warnings }))]
        .sort((left, right) => left.chapterNo - right.chapterNo)
      : plan.chapters,
    batches: plan.batches.map((item) => item.batchNo === batchNo ? {
      ...item,
      status: audit.passed ? "approved" : "blocked",
      qualityGate: { ...audit, checkedAt: now, repairAttempts }
    } : item),
    updatedAt: now
  });
}

export function readCharacterProfile(entity: BookEntityRecord): CharacterProfile | null {
  if (entity.entityType !== "character") return null;
  const parsed = characterProfileSchema.safeParse(entity.attributes.profile);
  return parsed.success ? parsed.data : null;
}

/** 旧人物属性迁移为五层档案，确保历史作品无需人工补 JSON 才能参与生成约束。 */
export function normalizeCharacterProfile(attributes: Record<string, unknown>, fallback: { description: string; state?: string }): CharacterProfile {
  const existing = characterProfileSchema.safeParse(attributes.profile);
  if (existing.success) return existing.data;
  const text = (key: string, max: number) => typeof attributes[key] === "string" ? compact(String(attributes[key]), max) : "";
  const list = (key: string, maxItems: number, maxCharacters: number) => Array.isArray(attributes[key])
    ? [...new Set((attributes[key] as unknown[]).filter((item): item is string => typeof item === "string").map((item) => compact(item, maxCharacters)).filter(Boolean))].slice(0, maxItems)
    : [];
  return characterProfileSchema.parse({
    schemaVersion: "character-profile.v1",
    core: {
      appearance: text("appearance", 500),
      personalityTraits: list("personalityTraits", 20, 240),
      motivations: [text("motivation", 240)].filter(Boolean),
      values: list("values", 15, 240),
      hardConstraints: [text("weakness", 240)].filter(Boolean),
      prohibitedActions: list("prohibitedActions", 20, 120)
    },
    arc: { startState: compact(fallback.description, 300), targetState: text("arc", 300), milestones: [] },
    timeline: { currentState: compact(fallback.state ?? fallback.description, 500), knownHistory: [] },
    relationships: [],
    dialogueDna: {
      voice: text("voice", 300),
      sentenceRhythm: text("sentenceRhythm", 200),
      signaturePhrases: list("signaturePhrases", 20, 100),
      forbiddenExpressions: list("forbiddenExpressions", 30, 100),
      subtextHabits: list("subtextHabits", 15, 240)
    }
  });
}

export function createInitialWorldRuleRegistry(
  bookId: string,
  rules: Array<{ id?: string; title: string; content: string; category?: "law" | "setting" | "history" | "story_fact"; mutability?: "immutable" | "mutable" }>,
  now = new Date().toISOString()
): WorldRuleRegistry {
  return worldRuleRegistrySchema.parse({
    schemaVersion: "world-rule-registry.v1",
    bookId,
    rules: rules.map((rule, index) => ({
      id: rule.id ?? `world-rule-${String(index + 1).padStart(2, "0")}`,
      title: rule.title,
      content: compact(rule.content),
      category: rule.category ?? "setting",
      mutability: rule.mutability ?? "immutable",
      status: "active",
      source: "initialization",
      sourceChapterNo: null,
      evidence: "作品初始化设定",
      createdAt: now,
      updatedAt: now
    })),
    proposals: [],
    updatedAt: now
  });
}

export async function readWorldRuleRegistry(paths: WorkspacePaths, bookId: string): Promise<WorldRuleRegistry | null> {
  const filePath = createBookPaths(paths, bookId).worldRulesFile;
  if (!(await pathExists(filePath))) return null;
  return readJsonFile(filePath, worldRuleRegistrySchema, null as never).catch(() => null);
}

export async function writeWorldRuleRegistry(paths: WorkspacePaths, bookId: string, registry: WorldRuleRegistry): Promise<void> {
  await writeJsonFile(createBookPaths(paths, bookId).worldRulesFile, worldRuleRegistrySchema.parse(registry));
}

/** 人工裁决规则改写提案；不可变规则也只能通过此显式审核路径产生新版本。 */
export function reviewWorldRuleProposal(
  registry: WorldRuleRegistry,
  proposalId: string,
  approved: boolean,
  reason = ""
): WorldRuleRegistry {
  const next = structuredClone(registry);
  const proposal = next.proposals.find((item) => item.id === proposalId);
  if (!proposal) throw new Error(`世界规则提案不存在：${proposalId}`);
  if (proposal.status !== "proposed") throw new Error(`世界规则提案已处理：${proposalId}`);
  const now = new Date().toISOString();
  proposal.reviewedAt = now;
  if (!approved) {
    proposal.status = "rejected";
    proposal.reason = reason.trim() || "用户拒绝规则改写";
    next.updatedAt = now;
    return worldRuleRegistrySchema.parse(next);
  }
  const target = proposal.targetRuleId
    ? next.rules.find((rule) => rule.id === proposal.targetRuleId && rule.status === "active")
    : null;
  if (!target) throw new Error(`规则改写目标不存在或已失效：${proposal.targetRuleId ?? "未指定"}`);
  target.status = "superseded";
  target.updatedAt = now;
  next.rules.push({
    ...target,
    id: `${target.id}-revision-${sha256(`${proposal.id}:${now}`).slice(0, 8)}`,
    title: proposal.title,
    content: proposal.content,
    prohibitedExpressions: [],
    status: "active",
    source: "user",
    sourceChapterNo: proposal.chapterNo,
    evidence: proposal.evidence,
    createdAt: now,
    updatedAt: now
  });
  proposal.status = "applied";
  proposal.reason = reason.trim() || "用户批准规则改写，旧版本已标记为 superseded";
  next.updatedAt = now;
  return worldRuleRegistrySchema.parse(next);
}

/**
 * 世界演进闭环：有正文证据的新剧情事实自动入库；修改既有规则的提案保留 proposed，等待人工审核。
 * 这样既能自动演进，又不会让一次 Observer 幻觉覆盖世界底层规则。
 */
export function applyWorldRuleProposals(registry: WorldRuleRegistry, chapterNo: number, proposals: WorldRuleProposal[]): WorldRuleRegistry {
  const now = new Date().toISOString();
  const next = structuredClone(registry);
  for (const proposal of proposals) {
    const fingerprint = sha256(`${chapterNo}:${proposal.kind}:${proposal.targetRuleId ?? ""}:${proposal.title}:${proposal.content}:${proposal.evidence}`);
    const proposalId = `world-proposal-${fingerprint.slice(0, 12)}`;
    if (next.proposals.some((item) => item.id === proposalId)) continue;
    if (proposal.kind === "new_fact") {
      const duplicate = next.rules.some((rule) => rule.status === "active" && normalize(rule.content) === normalize(proposal.content));
      next.proposals.push({
        ...proposal,
        id: proposalId,
        chapterNo,
        status: duplicate ? "rejected" : "applied",
        reason: duplicate ? "与现有有效规则重复" : "正文明确给出的新剧情事实，已自动写入规则库",
        createdAt: now,
        reviewedAt: now
      });
      if (!duplicate) {
        next.rules.push({
          id: `story-fact-${chapterNo}-${fingerprint.slice(0, 8)}`,
          title: proposal.title,
          content: proposal.content,
          prohibitedExpressions: [],
          category: "story_fact",
          mutability: "mutable",
          status: "active",
          source: "chapter-observer",
          sourceChapterNo: chapterNo,
          evidence: proposal.evidence,
          createdAt: now,
          updatedAt: now
        });
      }
    } else {
      const target = proposal.targetRuleId ? next.rules.find((rule) => rule.id === proposal.targetRuleId && rule.status === "active") : null;
      next.proposals.push({
        ...proposal,
        id: proposalId,
        chapterNo,
        status: "proposed",
        reason: target?.mutability === "immutable" ? "目标为不可变规则，必须人工裁决" : "规则变更必须人工审核",
        createdAt: now,
        reviewedAt: null
      });
    }
  }
  next.updatedAt = now;
  return worldRuleRegistrySchema.parse(next);
}

/** 从保留的初始化/用户规则和当前有效章节事件重建演进结果，旧章改写时不会留下过期世界事实。 */
export function rebuildWorldRuleRegistry(
  registry: WorldRuleRegistry,
  events: Array<{ chapterNo: number; delta: { worldRuleProposals?: WorldRuleProposal[] } }>
): WorldRuleRegistry {
  let rebuilt = worldRuleRegistrySchema.parse({
    ...registry,
    rules: registry.rules.filter((rule) => rule.source !== "chapter-observer"),
    proposals: [],
    updatedAt: registry.updatedAt
  });
  for (const event of [...events].sort((left, right) => left.chapterNo - right.chapterNo)) {
    rebuilt = applyWorldRuleProposals(rebuilt, event.chapterNo, event.delta.worldRuleProposals ?? []);
  }
  return rebuilt;
}

function normalize(value: string) {
  return value.replace(/[\s，。！？、；："'（）【】《》]/g, "").toLowerCase();
}

function compact(value: string, max = 240) {
  const characters = Array.from(value.trim());
  return characters.length <= max ? value.trim() : `${characters.slice(0, max - 1).join("")}…`;
}

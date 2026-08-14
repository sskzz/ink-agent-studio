import {
  characterProfileSchema,
  lockedTermSchema,
  storyPlanChapterSchema,
  storyPlanSchema,
  storyPlanVolumeSchema,
  worldRuleSchema,
  worldRuleRegistrySchema,
  type CharacterProfile,
  type StoryPlan,
  type WorldRule
} from "../../schemas/storyKnowledgeSchemas.js";
import {
  runtimeForeshadowingSchema,
  type RuntimeForeshadowing
} from "../../schemas/runtimeStateSchemas.js";
import { badRequest, conflict, notFound } from "../../utils/errors.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { getBook } from "./bookRepository.js";
import { getEntity, listEntities, saveEntity } from "./entityService.js";
import {
  buildEntityNameMap,
  readRuntimeState,
  replaceRuntimeBaseline,
  writeRuntimeState,
  writeStateProjections
} from "./runtimeStateRepository.js";
import {
  auditStoryPlanBatch,
  readStoryPlan,
  readWorldRuleRegistry,
  writeStoryPlan,
  writeWorldRuleRegistry
} from "./storyKnowledgeRepository.js";

const statusOrder = ["planned", "planted", "advancing", "resolving", "resolved", "archived"] as const;

export async function updateStoryPlanMainLine(paths: WorkspacePaths, bookId: string, mainLine: string) {
  const plan = await requireStoryPlan(paths, bookId);
  return persistPlan(paths, bookId, { ...plan, mainLine: mainLine.trim(), updatedAt: new Date().toISOString() });
}

export async function upsertLockedTerm(paths: WorkspacePaths, bookId: string, value: unknown) {
  const plan = await requireStoryPlan(paths, bookId);
  const term = lockedTermSchema.parse(value);
  const duplicate = plan.terms.find((item) => item.id !== term.id && item.term === term.term);
  if (duplicate) throw conflict("专名正文与已有条目重复", { id: term.id, duplicateId: duplicate.id, term: term.term });
  const next = {
    ...plan,
    terms: plan.terms.some((item) => item.id === term.id)
      ? plan.terms.map((item) => item.id === term.id ? term : item)
      : [...plan.terms, term],
    updatedAt: new Date().toISOString()
  };
  return persistPlan(paths, bookId, next);
}

export async function deleteLockedTerm(paths: WorkspacePaths, bookId: string, termId: string) {
  const plan = await requireStoryPlan(paths, bookId);
  if (!plan.terms.some((item) => item.id === termId)) throw notFound("专名不存在", { bookId, termId });
  const referencedBy = plan.chapters.filter((chapter) => chapter.lockedTermIds.includes(termId)).map((chapter) => chapter.chapterNo);
  if (referencedBy.length > 0) throw conflict("专名仍被章级细纲引用，不能删除", { termId, referencedBy });
  return persistPlan(paths, bookId, {
    ...plan,
    terms: plan.terms.filter((item) => item.id !== termId),
    updatedAt: new Date().toISOString()
  });
}

export async function updateStoryPlanVolume(paths: WorkspacePaths, bookId: string, volumeNo: number, value: unknown) {
  const plan = await requireStoryPlan(paths, bookId);
  const volume = storyPlanVolumeSchema.parse({ ...(value as object), volumeNo });
  if (!plan.volumes.some((item) => item.volumeNo === volumeNo)) throw notFound("大纲卷不存在", { bookId, volumeNo });
  return persistPlan(paths, bookId, {
    ...plan,
    volumes: plan.volumes.map((item) => item.volumeNo === volumeNo ? volume : item),
    updatedAt: new Date().toISOString()
  });
}

export async function upsertStoryPlanChapter(paths: WorkspacePaths, bookId: string, chapterNo: number, value: unknown) {
  const plan = await requireStoryPlan(paths, bookId);
  const chapter = storyPlanChapterSchema.parse({ ...(value as object), chapterNo });
  const entities = await listEntities(paths, bookId, "character");
  const characterIds = new Set(entities.map((entity) => entity.id));
  validateChapterReferences(plan, chapter, characterIds);
  return persistPlan(paths, bookId, {
    ...plan,
    chapters: [...plan.chapters.filter((item) => item.chapterNo !== chapterNo), chapter]
      .sort((left, right) => left.chapterNo - right.chapterNo),
    updatedAt: new Date().toISOString()
  });
}

export async function deleteStoryPlanChapter(paths: WorkspacePaths, bookId: string, chapterNo: number) {
  const plan = await requireStoryPlan(paths, bookId);
  if (!plan.chapters.some((item) => item.chapterNo === chapterNo)) throw notFound("章级细纲不存在", { bookId, chapterNo });
  return persistPlan(paths, bookId, {
    ...plan,
    chapters: plan.chapters.filter((item) => item.chapterNo !== chapterNo),
    updatedAt: new Date().toISOString()
  });
}

export async function reauditStoryPlanBatch(paths: WorkspacePaths, bookId: string, batchNo: number) {
  const plan = await requireStoryPlan(paths, bookId);
  const batch = plan.batches.find((item) => item.batchNo === batchNo);
  if (!batch) throw notFound("大纲批次不存在", { bookId, batchNo });
  const characterIds = new Set((await listEntities(paths, bookId, "character")).map((entity) => entity.id));
  const chapters = plan.chapters.filter((chapter) => chapter.chapterNo >= batch.chapterRange.start && chapter.chapterNo <= batch.chapterRange.end);
  const audit = auditStoryPlanBatch(plan, chapters, characterIds);
  const now = new Date().toISOString();
  return persistPlan(paths, bookId, {
    ...plan,
    chapters: plan.chapters.map((chapter) => chapter.chapterNo >= batch.chapterRange.start && chapter.chapterNo <= batch.chapterRange.end
      ? { ...chapter, status: audit.passed ? "approved" as const : "blocked" as const, reviewNotes: [...audit.blockingIssues, ...audit.warnings] }
      : chapter),
    batches: plan.batches.map((item) => item.batchNo === batchNo ? {
      ...item,
      status: audit.passed ? "approved" as const : "blocked" as const,
      qualityGate: { ...audit, checkedAt: now, repairAttempts: item.qualityGate?.repairAttempts ?? 0 }
    } : item),
    updatedAt: now
  });
}

/** 保存完整五层角色档案，同时验证关系目标、去重和成长里程碑范围。 */
export async function saveCharacterProfileValidated(paths: WorkspacePaths, bookId: string, characterId: string, value: unknown) {
  const profile = characterProfileSchema.parse(value);
  const [entity, characters, plan] = await Promise.all([
    getEntity(paths, bookId, characterId),
    listEntities(paths, bookId, "character"),
    readStoryPlan(paths, bookId)
  ]);
  if (entity.entityType !== "character") throw badRequest("只有角色实体可以保存人物档案", { characterId });
  const characterIds = new Set(characters.map((item) => item.id));
  const relationIds = new Set<string>();
  for (const relation of profile.relationships) {
    if (relation.targetCharacterId === characterId) throw badRequest("人物关系不能指向自己", { characterId });
    if (!characterIds.has(relation.targetCharacterId)) throw badRequest("人物关系目标不存在", { characterId, targetCharacterId: relation.targetCharacterId });
    if (relationIds.has(relation.targetCharacterId)) throw conflict("同一人物关系目标重复", { characterId, targetCharacterId: relation.targetCharacterId });
    relationIds.add(relation.targetCharacterId);
  }
  for (const milestone of profile.arc.milestones) {
    if (milestone.chapterRange.start > milestone.chapterRange.end) throw badRequest("成长里程碑章节范围起点不能晚于终点", milestone.chapterRange);
    if (plan && milestone.chapterRange.end > plan.plannedChapterCount) {
      throw badRequest("成长里程碑超出全书规划章节数", { range: milestone.chapterRange, plannedChapterCount: plan.plannedChapterCount });
    }
  }
  return saveEntity(paths, bookId, {
    id: entity.id,
    entityType: entity.entityType,
    name: entity.name,
    role: entity.role,
    description: entity.description,
    attributes: { ...entity.attributes, profile }
  });
}

export interface WorldRuleMutationInput {
  id: string;
  title: string;
  content: string;
  category: WorldRule["category"];
  mutability: WorldRule["mutability"];
  prohibitedExpressions?: string[];
  evidence?: string;
}

export async function upsertWorldRule(paths: WorkspacePaths, bookId: string, input: WorldRuleMutationInput) {
  await getBook(paths, bookId);
  const registry = await readWorldRuleRegistry(paths, bookId);
  const now = new Date().toISOString();
  const existing = registry?.rules.find((rule) => rule.id === input.id);
  const rule = worldRuleSchema.parse({
    ...input,
    prohibitedExpressions: input.prohibitedExpressions ?? [],
    status: existing?.status === "archived" ? "archived" : "active",
    source: existing?.source ?? "user",
    sourceChapterNo: existing?.sourceChapterNo ?? null,
    evidence: input.evidence ?? existing?.evidence ?? "用户维护",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  });
  const next = worldRuleRegistrySchema.parse({
    schemaVersion: "world-rule-registry.v1",
    bookId,
    rules: registry
      ? (existing ? registry.rules.map((item) => item.id === rule.id ? rule : item) : [...registry.rules, rule])
      : [rule],
    proposals: registry?.proposals ?? [],
    updatedAt: now
  });
  await writeWorldRuleRegistry(paths, bookId, next);
  return next;
}

export async function archiveWorldRule(paths: WorkspacePaths, bookId: string, ruleId: string) {
  const registry = await readWorldRuleRegistry(paths, bookId);
  if (!registry) throw notFound("世界规则库不存在", { bookId });
  if (!registry.rules.some((rule) => rule.id === ruleId)) throw notFound("世界规则不存在", { bookId, ruleId });
  const now = new Date().toISOString();
  const next = worldRuleRegistrySchema.parse({
    ...registry,
    rules: registry.rules.map((rule) => rule.id === ruleId ? { ...rule, status: "archived", updatedAt: now } : rule),
    updatedAt: now
  });
  await writeWorldRuleRegistry(paths, bookId, next);
  return next;
}

export async function upsertForeshadowing(paths: WorkspacePaths, bookId: string, value: unknown) {
  const item = runtimeForeshadowingSchema.parse(value);
  const runtime = await readRuntimeState(paths, bookId);
  if (!runtime) throw notFound("作品运行时状态不存在，无法维护伏笔池", { bookId });
  const entities = await listEntities(paths, bookId);
  const entityIds = new Set(entities.map((entity) => entity.id));
  const unknownIds = item.relatedEntityIds.filter((id) => !entityIds.has(id));
  if (unknownIds.length > 0) throw badRequest("伏笔引用了不存在的实体", { foreshadowingId: item.id, unknownIds });
  if (item.targetChapterRange && item.targetChapterRange.start > item.targetChapterRange.end) {
    throw badRequest("伏笔目标章节范围起点不能晚于终点", item.targetChapterRange);
  }
  const current = runtime.state.foreshadowing.find((entry) => entry.id === item.id);
  assertForeshadowingForward(current?.status, item.status, item.id);
  const baselineItem = runtime.baseline.foreshadowing.find((entry) => entry.id === item.id);
  const nextItem = runtimeForeshadowingSchema.parse({
    ...(baselineItem ?? current ?? {}),
    ...item,
    status: item.status,
    lastAdvancedChapter: Math.max(current?.lastAdvancedChapter ?? 0, item.lastAdvancedChapter ?? 0) || null
  });
  return persistForeshadowingBaseline(paths, bookId, runtime, entities, nextItem);
}

export async function advanceForeshadowingStatus(
  paths: WorkspacePaths,
  bookId: string,
  foreshadowingId: string,
  status: RuntimeForeshadowing["status"],
  lastAdvancedChapter?: number | null
) {
  const runtime = await readRuntimeState(paths, bookId);
  if (!runtime) throw notFound("作品运行时状态不存在", { bookId });
  const current = runtime.state.foreshadowing.find((item) => item.id === foreshadowingId);
  if (!current) throw notFound("伏笔不存在", { bookId, foreshadowingId });
  assertForeshadowingForward(current.status, status, foreshadowingId);
  const entities = await listEntities(paths, bookId);
  const nextItem = runtimeForeshadowingSchema.parse({
    ...(runtime.baseline.foreshadowing.find((item) => item.id === foreshadowingId) ?? current),
    status,
    lastAdvancedChapter: Math.max(current.lastAdvancedChapter ?? 0, lastAdvancedChapter ?? 0) || null
  });
  return persistForeshadowingBaseline(paths, bookId, runtime, entities, nextItem);
}

export function archiveForeshadowing(paths: WorkspacePaths, bookId: string, foreshadowingId: string) {
  return advanceForeshadowingStatus(paths, bookId, foreshadowingId, "archived");
}

async function persistForeshadowingBaseline(
  paths: WorkspacePaths,
  bookId: string,
  runtime: NonNullable<Awaited<ReturnType<typeof readRuntimeState>>>,
  entities: Awaited<ReturnType<typeof listEntities>>,
  item: RuntimeForeshadowing
) {
  const baseline = {
    ...runtime.baseline,
    foreshadowing: runtime.baseline.foreshadowing.some((entry) => entry.id === item.id)
      ? runtime.baseline.foreshadowing.map((entry) => entry.id === item.id ? item : entry)
      : [...runtime.baseline.foreshadowing, item]
  };
  const next = replaceRuntimeBaseline(runtime, baseline);
  await writeRuntimeState(paths, bookId, next);
  await writeStateProjections(paths, bookId, next, buildEntityNameMap(entities));
  return next.state.foreshadowing.find((entry) => entry.id === item.id)!;
}

function assertForeshadowingForward(current: RuntimeForeshadowing["status"] | undefined, next: RuntimeForeshadowing["status"], id: string) {
  if (current && statusOrder.indexOf(next) < statusOrder.indexOf(current)) {
    throw conflict("伏笔生命周期状态不能倒退", { foreshadowingId: id, current, next });
  }
}

async function requireStoryPlan(paths: WorkspacePaths, bookId: string) {
  const plan = await readStoryPlan(paths, bookId);
  if (!plan) throw notFound("作品尚未生成结构化三层大纲", { bookId });
  return plan;
}

async function persistPlan(paths: WorkspacePaths, bookId: string, value: StoryPlan) {
  const plan = storyPlanSchema.parse(value);
  validateStoryPlanStructure(plan);
  await writeStoryPlan(paths, bookId, plan);
  return plan;
}

function validateStoryPlanStructure(plan: StoryPlan) {
  const termIds = new Set<string>();
  const termNames = new Set<string>();
  for (const term of plan.terms) {
    if (termIds.has(term.id) || termNames.has(term.term)) throw conflict("专名 ID 或正文重复", { id: term.id, term: term.term });
    termIds.add(term.id);
    termNames.add(term.term);
  }
  const volumeNos = new Set<number>();
  const volumeIds = new Set<string>();
  for (const volume of [...plan.volumes].sort((left, right) => left.chapterRange.start - right.chapterRange.start)) {
    if (volume.chapterRange.start > volume.chapterRange.end) throw badRequest("卷章节范围起点不能晚于终点", { volumeNo: volume.volumeNo, range: volume.chapterRange });
    if (volume.chapterRange.end > plan.plannedChapterCount) throw badRequest("卷章节范围超出全书规划章节数", { volumeNo: volume.volumeNo, range: volume.chapterRange });
    if (volumeNos.has(volume.volumeNo) || volumeIds.has(volume.id)) throw conflict("卷编号或 ID 重复", { volumeNo: volume.volumeNo, id: volume.id });
    volumeNos.add(volume.volumeNo);
    volumeIds.add(volume.id);
  }
  const ordered = [...plan.volumes].sort((left, right) => left.chapterRange.start - right.chapterRange.start);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].chapterRange.start <= ordered[index - 1].chapterRange.end) {
      throw conflict("卷章节范围重叠", { left: ordered[index - 1].volumeNo, right: ordered[index].volumeNo });
    }
  }
  const chapterNos = new Set<number>();
  for (const chapter of plan.chapters) {
    if (chapterNos.has(chapter.chapterNo)) throw conflict("章级细纲章节号重复", { chapterNo: chapter.chapterNo });
    chapterNos.add(chapter.chapterNo);
    const volume = plan.volumes.find((item) => chapter.chapterNo >= item.chapterRange.start && chapter.chapterNo <= item.chapterRange.end);
    if (!volume || volume.volumeNo !== chapter.volumeNo) throw badRequest("章级细纲卷号与卷范围不一致", { chapterNo: chapter.chapterNo, volumeNo: chapter.volumeNo });
    const unknownTerms = chapter.lockedTermIds.filter((id) => !termIds.has(id));
    if (unknownTerms.length > 0) throw badRequest("章级细纲引用未知专名", { chapterNo: chapter.chapterNo, unknownTerms });
  }
  const batchNos = new Set<number>();
  for (const batch of plan.batches) {
    if (batchNos.has(batch.batchNo)) throw conflict("大纲批次编号重复", { batchNo: batch.batchNo });
    batchNos.add(batch.batchNo);
    if (batch.chapterRange.start > batch.chapterRange.end || batch.chapterRange.end > plan.plannedChapterCount) {
      throw badRequest("大纲批次章节范围非法", { batchNo: batch.batchNo, range: batch.chapterRange });
    }
    if (!plan.volumes.some((volume) => batch.chapterRange.start >= volume.chapterRange.start && batch.chapterRange.end <= volume.chapterRange.end)) {
      throw badRequest("大纲批次必须完整归属于单卷", { batchNo: batch.batchNo, range: batch.chapterRange });
    }
  }
}

function validateChapterReferences(plan: StoryPlan, chapter: StoryPlan["chapters"][number], characterIds: Set<string>) {
  const volume = plan.volumes.find((item) => chapter.chapterNo >= item.chapterRange.start && chapter.chapterNo <= item.chapterRange.end);
  if (!volume || volume.volumeNo !== chapter.volumeNo) throw badRequest("章节号不属于指定卷", { chapterNo: chapter.chapterNo, volumeNo: chapter.volumeNo });
  const termIds = new Set(plan.terms.map((term) => term.id));
  const unknownTerms = chapter.lockedTermIds.filter((id) => !termIds.has(id));
  if (unknownTerms.length > 0) throw badRequest("章级细纲引用未知专名", { chapterNo: chapter.chapterNo, unknownTerms });
  const unknownCharacters = chapter.dimensions.characterActions.map((item) => item.characterId).filter((id) => !characterIds.has(id));
  if (unknownCharacters.length > 0) throw badRequest("章级细纲引用未知角色", { chapterNo: chapter.chapterNo, unknownCharacters });
}

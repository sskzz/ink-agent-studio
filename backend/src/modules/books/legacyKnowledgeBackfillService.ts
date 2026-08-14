import {
  characterProfileSchema,
  legacyKnowledgeBackfillDecisionStatusSchema,
  legacyKnowledgeBackfillProposalSchema,
  storyPlanSchema,
  worldRuleSchema,
  worldRuleRegistrySchema,
  type LegacyKnowledgeBackfillDecision,
  type LegacyKnowledgeBackfillProposal,
  type WorldRule
} from "../../schemas/storyKnowledgeSchemas.js";
import { chaptersIndexSchema } from "../../schemas/chapterSchemas.js";
import { conflict, notFound } from "../../utils/errors.js";
import { pathExists, readTextFile } from "../../utils/fileStore.js";
import { sha256 } from "../../utils/hash.js";
import { readJsonFile, writeJsonFile } from "../../utils/jsonStore.js";
import { resolveInsideRoot } from "../../utils/safePath.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { getBook } from "./bookRepository.js";
import { createBookPaths } from "./bookPaths.js";
import { listEntities, saveEntity } from "./entityService.js";
import { readRuntimeState } from "./runtimeStateRepository.js";
import {
  createInitialStoryPlan,
  createInitialWorldRuleRegistry,
  normalizeCharacterProfile,
  readCharacterProfile,
  readStoryPlan,
  readWorldRuleRegistry,
  writeStoryPlan,
  writeWorldRuleRegistry
} from "./storyKnowledgeRepository.js";

/** 读取已生成的回填提案；旧作品未预览过时返回 null。 */
export async function readLegacyKnowledgeBackfillProposal(paths: WorkspacePaths, bookId: string) {
  await getBook(paths, bookId);
  const proposalPath = createBookPaths(paths, bookId).legacyKnowledgeBackfillFile;
  if (!(await pathExists(proposalPath))) return null;
  return readJsonFile(proposalPath, legacyKnowledgeBackfillProposalSchema, null as never).catch(() => null);
}

/**
 * 从旧 Markdown、旧实体属性和运行时状态生成确定性回填提案。
 * 本函数只写 proposal 文件；不会改 story-plan、world-rules 或实体索引。
 */
export async function proposeLegacyKnowledgeBackfill(
  paths: WorkspacePaths,
  bookId: string
): Promise<LegacyKnowledgeBackfillProposal> {
  const bookPaths = createBookPaths(paths, bookId);
  const [book, entities, chapters, runtime, currentStoryPlan, currentWorldRules, brief, outline, world] = await Promise.all([
    getBook(paths, bookId),
    listEntities(paths, bookId),
    readJsonFile(bookPaths.chaptersIndexFile, chaptersIndexSchema, []),
    readRuntimeState(paths, bookId),
    readStoryPlan(paths, bookId),
    readWorldRuleRegistry(paths, bookId),
    readTextFile(bookPaths.briefFile).catch(() => ""),
    readTextFile(bookPaths.outlineFile).catch(() => ""),
    readTextFile(bookPaths.worldFile).catch(() => "")
  ]);
  const sourceHash = sha256(JSON.stringify({
    book,
    entities: entities.map((entity) => ({ id: entity.id, updatedAt: entity.updatedAt, attributes: entity.attributes })),
    chapters: chapters.map((chapter) => ({ id: chapter.id, chapterNo: chapter.chapterNo, outline: chapter.outline, updatedAt: chapter.updatedAt })),
    runtime: runtime?.state ?? null,
    currentStoryPlan,
    currentWorldRules,
    brief,
    outline,
    world
  }));
  const previous = await readLegacyKnowledgeBackfillProposal(paths, bookId);
  if (previous?.status === "proposed" && previous.sourceHash === sourceHash) return previous;

  const plannedChapterCount = inferPlannedChapterCount(book, chapters.length);
  const volumeTitles = extractVolumeTitles(outline);
  const volumeCount = Math.max(1, Math.min(100, volumeTitles.length || inferVolumeCount(chapters)));
  const volumes = Array.from({ length: volumeCount }, (_, index) => ({
    title: volumeTitles[index] ?? `第 ${index + 1} 卷`,
    goal: `承接旧卷纲第 ${index + 1} 卷目标，应用后请人工审核补全。`,
    conflict: `承接旧卷纲第 ${index + 1} 卷核心冲突，应用后请人工审核补全。`,
    turningPoint: `第 ${index + 1} 卷关键转折待从旧稿人工确认。`,
    climax: `第 ${index + 1} 卷高潮待从旧稿人工确认。`,
    resolution: `第 ${index + 1} 卷收束与下一卷钩子待人工确认。`,
    characterChanges: []
  }));
  const terms = entities.slice(0, 300).map((entity) => ({
    id: toKnowledgeId(`term-${entity.id}`),
    term: entity.name,
    category: entity.entityType,
    aliases: Array.isArray(entity.attributes.aliases)
      ? [...new Set(entity.attributes.aliases
          .filter((value): value is string => typeof value === "string")
          .map((value) => Array.from(value.trim()).slice(0, 80).join(""))
          .filter(Boolean))].slice(0, 12)
      : [],
    note: `由旧实体 ${entity.id} 提议回填`
  }));
  const storyPlan = currentStoryPlan ?? createInitialStoryPlan(bookId, {
    mainLine: inferMainLine(brief, outline, book.title),
    estimatedChapters: plannedChapterCount,
    volumes,
    terms
  });
  const worldRules = currentWorldRules ?? createInitialWorldRuleRegistry(
    bookId,
    extractWorldRules(world, runtime?.state.publicFacts ?? [])
  );
  const characterProfiles = entities
    .filter((entity) => entity.entityType === "character")
    .map((entity) => {
      const currentState = runtime?.state.characterStates.find((state) => state.characterId === entity.id)?.state;
      return {
        entityId: entity.id,
        characterName: entity.name,
        profile: normalizeCharacterProfile(entity.attributes, { description: entity.description, state: currentState })
      };
    });
  const now = new Date().toISOString();
  const proposal = legacyKnowledgeBackfillProposalSchema.parse({
    schemaVersion: "legacy-knowledge-backfill.v1",
    id: `legacy-backfill-${sourceHash.slice(0, 12)}`,
    bookId,
    status: "proposed",
    sourceHash,
    storyPlan,
    worldRules,
    characterProfiles,
    decisions: buildInitialDecisions(storyPlan, worldRules, characterProfiles),
    warnings: [
      ...(currentStoryPlan ? ["当前作品已有结构化三层大纲；应用时会保留现有大纲，不覆盖。"] : ["卷级合同由旧 Markdown 确定性提取，应用后需人工审核目标、冲突、转折、高潮与收束。"]),
      ...(currentWorldRules ? ["当前作品已有世界规则库；应用时会保留现有规则，不覆盖。"] : ["世界规则只从 world.md 的列表项和运行时公开事实提取，未识别的自然语言规则需人工补充。"]),
      "人物档案仅填充旧属性中可确定映射的字段，关系图谱和成长里程碑默认留空。"
    ],
    createdAt: now,
    updatedAt: now,
    appliedAt: null
  });
  await writeJsonFile(bookPaths.legacyKnowledgeBackfillFile, proposal);
  return proposal;
}

export async function reviewLegacyKnowledgeBackfillItem(
  paths: WorkspacePaths,
  bookId: string,
  proposalId: string,
  itemKey: string,
  input: { status: "pending" | "accepted" | "rejected"; editedValue?: unknown; reason?: string }
) {
  const proposal = await requireOpenProposal(paths, bookId, proposalId);
  const existingValue = resolveProposalItem(proposal, itemKey);
  if (existingValue === undefined) throw notFound("旧作品知识回填审核项不存在", { bookId, proposalId, itemKey });
  const status = legacyKnowledgeBackfillDecisionStatusSchema.parse(input.status);
  const editedValue = input.editedValue === undefined ? undefined : parseEditedBackfillItem(itemKey, input.editedValue);
  const now = new Date().toISOString();
  const decision: LegacyKnowledgeBackfillDecision = {
    itemKey,
    status,
    ...(editedValue === undefined ? {} : { editedValue }),
    reason: input.reason?.trim() ?? "",
    reviewedAt: status === "pending" ? null : now
  };
  const next = legacyKnowledgeBackfillProposalSchema.parse({
    ...proposal,
    decisions: [...proposal.decisions.filter((item) => item.itemKey !== itemKey), decision],
    updatedAt: now
  });
  await writeJsonFile(createBookPaths(paths, bookId).legacyKnowledgeBackfillFile, next);
  return next;
}

/** 计算选择性应用的确定性预览；只读权威知识，不落任何变更。 */
export async function previewLegacyKnowledgeBackfillApply(paths: WorkspacePaths, bookId: string, proposalId: string) {
  const proposal = await requireOpenProposal(paths, bookId, proposalId);
  const [existingPlan, existingRules, entities] = await Promise.all([
    readStoryPlan(paths, bookId),
    readWorldRuleRegistry(paths, bookId),
    listEntities(paths, bookId)
  ]);
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const existingRuleIds = new Set(existingRules?.rules.map((rule) => rule.id) ?? []);
  const items = proposal.decisions.map((decision) => {
    let outcome: "will_create" | "skip_existing" | "skip_rejected" | "pending" | "missing_target" = "pending";
    if (decision.status === "rejected") outcome = "skip_rejected";
    else if (decision.status === "accepted") {
      if (decision.itemKey === "story-plan") outcome = existingPlan ? "skip_existing" : "will_create";
      else if (decision.itemKey.startsWith("world-rule:")) {
        outcome = existingRuleIds.has(decision.itemKey.slice("world-rule:".length)) ? "skip_existing" : "will_create";
      } else if (decision.itemKey.startsWith("character-profile:")) {
        const entity = entityById.get(decision.itemKey.slice("character-profile:".length));
        outcome = !entity || entity.entityType !== "character"
          ? "missing_target"
          : readCharacterProfile(entity) ? "skip_existing" : "will_create";
      }
    }
    return { itemKey: decision.itemKey, status: decision.status, outcome };
  });
  const counts = {
    accepted: items.filter((item) => item.status === "accepted").length,
    rejected: items.filter((item) => item.status === "rejected").length,
    pending: items.filter((item) => item.status === "pending").length,
    willCreate: items.filter((item) => item.outcome === "will_create").length,
    skipped: items.filter((item) => item.outcome !== "will_create" && item.outcome !== "pending").length
  };
  return {
    proposalId,
    sourceHash: proposal.sourceHash,
    authorityHash: sha256(JSON.stringify({ storyPlan: existingPlan, worldRules: existingRules, entities })),
    ready: counts.pending === 0 && counts.accepted > 0,
    counts,
    items
  };
}

/**
 * 显式应用回填提案：只创建缺失知识，并只给缺少 profile 的人物补档。
 * 发现权威数据已经存在时保留原数据，绝不覆盖用户在预览后新增或修改的内容。
 */
export async function applyLegacyKnowledgeBackfill(
  paths: WorkspacePaths,
  bookId: string,
  proposalId: string
) {
  const proposal = await requireOpenProposal(paths, bookId, proposalId);
  const preview = await previewLegacyKnowledgeBackfillApply(paths, bookId, proposalId);
  if (!preview.ready) {
    throw conflict("回填提案仍有待审核项，或尚未接受任何条目", { proposalId, counts: preview.counts });
  }

  const [existingPlan, existingRules, entities] = await Promise.all([
    readStoryPlan(paths, bookId),
    readWorldRuleRegistry(paths, bookId),
    listEntities(paths, bookId)
  ]);
  const snapshotPath = await writeBackfillSnapshot(paths, bookId, proposal, {
    storyPlan: existingPlan,
    worldRules: existingRules,
    entities
  }, preview.authorityHash);
  const decisions = new Map(proposal.decisions.map((decision) => [decision.itemKey, decision]));
  const applied = { storyPlan: false, worldRules: false, worldRuleCount: 0, characterProfiles: 0 };
  const planDecision = decisions.get("story-plan");
  if (!existingPlan && proposal.storyPlan && planDecision?.status === "accepted") {
    await writeStoryPlan(paths, bookId, storyPlanSchema.parse(planDecision.editedValue ?? proposal.storyPlan));
    applied.storyPlan = true;
  }
  const acceptedRules = (proposal.worldRules?.rules ?? []).flatMap((rule) => {
    const decision = decisions.get(`world-rule:${rule.id}`);
    return decision?.status === "accepted" ? [worldRuleSchema.parse(decision.editedValue ?? rule)] : [];
  });
  if (acceptedRules.length > 0) {
    const existingIds = new Set(existingRules?.rules.map((rule) => rule.id) ?? []);
    const newRules = acceptedRules.filter((rule) => !existingIds.has(rule.id));
    if (newRules.length > 0) {
      const now = new Date().toISOString();
      const nextRegistry = existingRules
        ? { ...existingRules, rules: [...existingRules.rules, ...newRules], updatedAt: now }
        : { schemaVersion: "world-rule-registry.v1" as const, bookId, rules: newRules, proposals: [], updatedAt: now };
      await writeWorldRuleRegistry(paths, bookId, worldRuleRegistrySchema.parse(nextRegistry));
      applied.worldRules = true;
      applied.worldRuleCount = newRules.length;
    }
  }
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  for (const candidate of proposal.characterProfiles) {
    const decision = decisions.get(`character-profile:${candidate.entityId}`);
    if (decision?.status !== "accepted") continue;
    const entity = entityById.get(candidate.entityId);
    if (!entity || entity.entityType !== "character" || readCharacterProfile(entity)) continue;
    await saveEntity(paths, bookId, {
      id: entity.id,
      entityType: entity.entityType,
      name: entity.name,
      role: entity.role,
      description: entity.description,
      attributes: { ...entity.attributes, profile: characterProfileSchema.parse(decision.editedValue ?? candidate.profile) }
    });
    applied.characterProfiles += 1;
  }
  const completed = legacyKnowledgeBackfillProposalSchema.parse({
    ...proposal,
    status: "applied",
    updatedAt: new Date().toISOString(),
    appliedAt: new Date().toISOString()
  });
  await writeJsonFile(createBookPaths(paths, bookId).legacyKnowledgeBackfillFile, completed);
  return { proposal: completed, applied, snapshotPath, preview };
}

function buildInitialDecisions(
  storyPlan: LegacyKnowledgeBackfillProposal["storyPlan"],
  worldRules: LegacyKnowledgeBackfillProposal["worldRules"],
  characterProfiles: LegacyKnowledgeBackfillProposal["characterProfiles"]
): LegacyKnowledgeBackfillDecision[] {
  return [
    ...(storyPlan ? [{ itemKey: "story-plan", status: "pending" as const, reason: "", reviewedAt: null }] : []),
    ...(worldRules?.rules ?? []).map((rule) => ({ itemKey: `world-rule:${rule.id}`, status: "pending" as const, reason: "", reviewedAt: null })),
    ...characterProfiles.map((item) => ({ itemKey: `character-profile:${item.entityId}`, status: "pending" as const, reason: "", reviewedAt: null }))
  ];
}

function resolveProposalItem(proposal: LegacyKnowledgeBackfillProposal, itemKey: string) {
  if (itemKey === "story-plan") return proposal.storyPlan ?? undefined;
  if (itemKey.startsWith("world-rule:")) {
    return proposal.worldRules?.rules.find((rule) => rule.id === itemKey.slice("world-rule:".length));
  }
  if (itemKey.startsWith("character-profile:")) {
    return proposal.characterProfiles.find((item) => item.entityId === itemKey.slice("character-profile:".length))?.profile;
  }
  return undefined;
}

function parseEditedBackfillItem(itemKey: string, value: unknown) {
  if (itemKey === "story-plan") return storyPlanSchema.parse(value);
  if (itemKey.startsWith("world-rule:")) {
    const parsed = worldRuleSchema.parse(value);
    if (parsed.id !== itemKey.slice("world-rule:".length)) throw conflict("编辑后的世界规则 ID 不可变更", { itemKey, id: parsed.id });
    return parsed;
  }
  if (itemKey.startsWith("character-profile:")) return characterProfileSchema.parse(value);
  throw notFound("旧作品知识回填审核项不存在", { itemKey });
}

async function requireOpenProposal(paths: WorkspacePaths, bookId: string, proposalId: string) {
  const proposal = await readLegacyKnowledgeBackfillProposal(paths, bookId);
  if (!proposal || proposal.id !== proposalId) throw notFound("旧作品知识回填提案不存在", { bookId, proposalId });
  if (proposal.status !== "proposed") throw conflict("旧作品知识回填提案已处理", { bookId, proposalId, status: proposal.status });
  return legacyKnowledgeBackfillProposalSchema.parse({
    ...proposal,
    decisions: proposal.decisions.length > 0
      ? proposal.decisions
      : buildInitialDecisions(proposal.storyPlan, proposal.worldRules, proposal.characterProfiles)
  });
}

async function writeBackfillSnapshot(
  paths: WorkspacePaths,
  bookId: string,
  proposal: LegacyKnowledgeBackfillProposal,
  authority: unknown,
  authorityHash: string
) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = resolveInsideRoot(createBookPaths(paths, bookId).knowledgeSnapshotsDir, `${timestamp}-${proposal.id}.json`);
  await writeJsonFile(filePath, {
    schemaVersion: "knowledge-snapshot.v1",
    bookId,
    reason: "legacy-knowledge-backfill-apply",
    proposalId: proposal.id,
    authorityHash,
    capturedAt: new Date().toISOString(),
    authority
  });
  return filePath;
}

function inferPlannedChapterCount(book: Awaited<ReturnType<typeof getBook>>, writtenChapterCount: number) {
  if (book.plannedWords && book.chapterWords) return Math.ceil(book.plannedWords / book.chapterWords);
  return Math.max(50, writtenChapterCount);
}

function inferVolumeCount(chapters: Array<{ volumeNo: number }>) {
  return chapters.reduce((max, chapter) => Math.max(max, chapter.volumeNo), 1);
}

function inferMainLine(brief: string, outline: string, title: string) {
  return firstUsefulLine(brief) ?? firstUsefulLine(outline) ?? `围绕《${title}》现有旧稿继续推进主线。`;
}

function firstUsefulLine(content: string) {
  return content.split(/\r?\n/u)
    .map((line) => line.replace(/^#+\s*/u, "").replace(/^[-*]\s*/u, "").trim())
    .find((line) => line.length >= 8 && !/^(故事基石|卷纲规划|世界观|待补充)/u.test(line));
}

function extractVolumeTitles(content: string) {
  const titles = new Map<number, string>();
  for (const line of content.split(/\r?\n/u)) {
    const match = /(?:^|\s)(?:第\s*)?(\d+)\s*卷(?:[：:·\s-]+)?(.+)?$/u.exec(line.replace(/^#+\s*/u, "").trim());
    if (!match) continue;
    titles.set(Number(match[1]), match[2]?.trim() || `第 ${match[1]} 卷`);
  }
  return [...titles.entries()].sort((left, right) => left[0] - right[0]).map(([, title]) => title);
}

function extractWorldRules(world: string, publicFacts: string[]) {
  const lines = world.split(/\r?\n/u)
    .map((line) => line.replace(/^[-*]\s*/u, "").trim())
    .filter((line) => line.length >= 6 && !line.startsWith("#") && !/^(待补充|世界观)/u.test(line));
  const unique = [...new Set([...lines, ...publicFacts])].slice(0, 80);
  if (unique.length === 0) {
    return [{ title: "旧世界观待人工结构化", content: "当前未从旧 world.md 提取到可靠列表项，请人工补充规则。", category: "setting" as const, mutability: "mutable" as const }];
  }
  return unique.map((content, index) => ({
    id: `legacy-world-${String(index + 1).padStart(2, "0")}`,
    title: compactTitle(content, index + 1),
    content,
    category: inferRuleCategory(content),
    mutability: /(?:永远|绝不|不可|不能|禁止|必须)/u.test(content) ? "immutable" as const : "mutable" as const
  }));
}

function inferRuleCategory(content: string): WorldRule["category"] {
  if (/(?:规则|法则|禁止|不能|必须|代价|能力)/u.test(content)) return "law";
  if (/(?:历史|曾经|纪元|战争|王朝)/u.test(content)) return "history";
  return "setting";
}

function compactTitle(content: string, index: number) {
  const title = Array.from(content.replace(/[。！？；].*$/u, "").trim()).slice(0, 24).join("");
  return title || `旧世界规则 ${index}`;
}

function toKnowledgeId(value: string) {
  const normalized = value.toLocaleLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  const safe = normalized.length >= 3 && /^[a-z]/.test(normalized) ? normalized : `term-${sha256(value).slice(0, 10)}`;
  return safe.slice(0, 64).replace(/-$/u, "0");
}

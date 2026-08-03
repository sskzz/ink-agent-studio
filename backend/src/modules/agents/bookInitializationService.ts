import path from "node:path";
import { z } from "zod";
import type { ModelGenerateTextInput, ModelGenerateTextResult } from "../ai/types.js";
import { generateModelTextWithFallback } from "../ai/modelGateway.js";
import {
  captureBookFilesSnapshot,
  getBookFileContent,
  restoreBookFilesSnapshot,
  updateBookFileContent
} from "../files/fileService.js";
import { getModelConfig, getModelRoutes } from "../models/modelConfigRepository.js";
import { getBook, saveBook } from "../books/bookRepository.js";
import {
  captureEntityStorageSnapshot,
  replaceGeneratedEntities,
  restoreEntityStorageSnapshot,
  type GeneratedEntityInput
} from "../books/entityService.js";
import { listWritingStyles } from "../styles/writingStyleService.js";
import type { BookRecord, ModelConfigRecord } from "../../types/domain.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { ensureDirectory } from "../../utils/fileStore.js";
import { writeJsonFile } from "../../utils/jsonStore.js";
import type { RunExecutionContext } from "./runCoordinator.js";
import { writeFactCards } from "../books/factRepository.js";
import type { FactCard } from "../../schemas/factSchemas.js";
import {
  appendFactContext,
  appendRepairIssues,
  buildSummaryFactCards,
  extractBackboneFacts,
  extractFoundationFacts,
  extractWorldFacts,
  normalizeLockedBookFields,
  verifyBackboneInitialStateConsistency,
  verifyBackboneOutlineConsistency,
  verifyBackboneReferences,
  verifyOutlineStateConsistency,
  verifyRequirementsBackboneConsistency,
  verifySupportingBackboneConsistency
} from "./initializationFacts.js";

const identifierSchema = z.string().regex(/^[a-z][a-z0-9-]{2,63}$/);
const shortText = z.string().trim().min(1).max(500);
const textList = z.array(shortText).min(1).max(12);
const initializationStageTimeoutMs = 300_000;

const foundationSchema = z.object({
  schemaVersion: z.literal("book-foundation.v1"),
  book: z.object({
    title: z.string().trim().min(1).max(100),
    genre: z.string().trim().min(1).max(80),
    narrationPerspective: z.string().trim().min(1).max(40),
    channel: z.string().trim().min(1).max(40),
    protagonistGender: z.string().trim().min(1).max(40),
    protagonistName: z.string().trim().min(1).max(80),
    plannedWords: z.number().int().min(20_000).max(20_000_000),
    chapterWords: z.number().int().min(500).max(20_000),
    writingStyleId: z.string().trim().nullable()
  }),
  premise: shortText,
  themes: textList,
  coreConflict: shortText,
  protagonistGoal: shortText,
  stakes: shortText,
  sellingPoints: textList,
  readerPromises: textList,
  boundaries: z.array(shortText).max(10)
});

const worldSchema = z.object({
  schemaVersion: z.literal("book-world.v1"),
  overview: shortText,
  era: shortText,
  society: shortText,
  rules: z.array(z.object({
    name: shortText,
    description: shortText,
    limitation: shortText,
    cost: shortText
  })).min(2).max(12),
  powerSystems: z.array(z.object({ name: shortText, description: shortText, limitation: shortText })).max(8),
  history: textList,
  regions: z.array(z.object({ id: identifierSchema, name: shortText, summary: shortText })).min(2).max(12),
  conflictSources: textList
});

const characterSchema = z.object({
  id: identifierSchema,
  name: z.string().trim().min(1).max(80),
  role: z.enum(["主要", "次要"]),
  identity: shortText,
  goal: shortText,
  motivation: shortText,
  weakness: shortText,
  arc: shortText,
  factionIds: z.array(identifierSchema).max(5)
});

const factionSchema = z.object({
  id: identifierSchema,
  name: z.string().trim().min(1).max(100),
  role: shortText,
  goal: shortText,
  resources: textList,
  limitations: textList,
  internalConflict: shortText
});

const storyGraphSchema = z.object({
  schemaVersion: z.literal("book-story-graph.v1"),
  characters: z.array(characterSchema).min(2).max(10),
  factions: z.array(factionSchema).min(1).max(8),
  relationships: z.array(z.object({
    fromId: identifierSchema,
    toId: identifierSchema,
    relation: shortText,
    tension: shortText
  })).min(1).max(30)
});

const entityRequirementSchema = z.object({
  id: identifierSchema,
  nameHint: shortText,
  purpose: shortText,
  firstUse: shortText
});

const backboneEventSchema = z.object({
  id: identifierSchema,
  title: shortText,
  detail: shortText,
  relatedEntityIds: z.array(identifierSchema).max(8)
});

const storyBackboneSchema = z.object({
  schemaVersion: z.literal("book-story-backbone.v1"),
  startEvents: z.array(backboneEventSchema.extend({
    status: z.enum(["happened", "ongoing"])
  })).min(1).max(20),
  keyEvents: z.array(backboneEventSchema.extend({
    volumeIndex: z.number().int().min(1).max(100)
  })).min(1).max(40),
  timelineNote: shortText
});

const volumeOutlineSchema = z.object({
  title: shortText,
  goal: shortText,
  conflict: shortText,
  turningPoint: shortText,
  climax: shortText,
  resolution: shortText,
  characterChanges: textList,
  foreshadowing: textList
});

const requiredEntitiesSchema = z.object({
  locations: z.array(entityRequirementSchema).max(20),
  supportingCharacters: z.array(entityRequirementSchema).max(30),
  items: z.array(entityRequirementSchema).max(20)
});

const outlinePlanSchema = z.object({
  schemaVersion: z.literal("book-outline-plan.v1"),
  mainLine: shortText,
  estimatedChapters: z.number().int().min(1).max(20_000),
  volumes: z.array(volumeOutlineSchema).min(1).max(30)
});

const entityRequirementsSchema = z.object({
  schemaVersion: z.literal("book-entity-requirements.v1"),
  requiredEntities: requiredEntitiesSchema
});

const outlineSchema = z.object({
  schemaVersion: z.literal("book-outline.v1"),
  mainLine: shortText,
  estimatedChapters: z.number().int().min(1).max(20_000),
  volumes: z.array(volumeOutlineSchema).min(1).max(30),
  requiredEntities: requiredEntitiesSchema
});

const locationSchema = z.object({
  id: identifierSchema,
  name: shortText,
  role: shortText,
  description: shortText,
  regionId: identifierSchema,
  controllerFactionId: identifierSchema.nullable(),
  rules: textList,
  firstUse: shortText
});

const supportingEntitiesSchema = z.object({
  schemaVersion: z.literal("book-supporting-entities.v1"),
  locations: z.array(locationSchema).max(20),
  supportingCharacters: z.array(characterSchema).max(30)
});

const itemSchema = z.object({
  id: identifierSchema,
  name: shortText,
  role: shortText,
  description: shortText,
  ownerEntityId: identifierSchema.nullable(),
  locationId: identifierSchema.nullable(),
  abilities: textList,
  limitations: textList,
  firstUse: shortText,
  resolution: shortText
});

const itemsSchema = z.object({
  schemaVersion: z.literal("book-items.v1"),
  items: z.array(itemSchema).max(20)
});

const stateBundleSchema = z.object({
  schemaVersion: z.literal("book-initial-state.v1"),
  storyStart: shortText,
  publicFacts: textList,
  secrets: textList,
  nextGoals: textList,
  characterStates: z.array(z.object({ characterId: identifierSchema, state: shortText })).min(1).max(40),
  factionStates: z.array(z.object({ factionId: identifierSchema, state: shortText })).max(20),
  itemStates: z.array(z.object({ itemId: identifierSchema, state: shortText })).max(30),
  foreshadowing: z.array(z.object({
    id: identifierSchema,
    content: shortText,
    relatedEntityIds: z.array(identifierSchema).max(8),
    placement: shortText,
    resolution: shortText,
    status: z.enum(["planned", "planted", "resolving", "resolved"])
  })).min(1).max(40)
});

const reviewSchema = z.object({
  schemaVersion: z.literal("book-initialization-review.v1"),
  passed: z.boolean(),
  issues: z.array(z.object({ severity: z.enum(["warning", "blocking"]), message: shortText })).max(20),
  summary: shortText
});

export type Foundation = z.infer<typeof foundationSchema>;
export type World = z.infer<typeof worldSchema>;
export type StoryGraph = z.infer<typeof storyGraphSchema>;
export type StoryBackbone = z.infer<typeof storyBackboneSchema>;
export type OutlinePlan = z.infer<typeof outlinePlanSchema>;
export type EntityRequirements = z.infer<typeof entityRequirementsSchema>;
export type Outline = z.infer<typeof outlineSchema>;
export type SupportingEntities = z.infer<typeof supportingEntitiesSchema>;
export type Items = z.infer<typeof itemsSchema>;
export type StateBundle = z.infer<typeof stateBundleSchema>;

export interface InitializationBundle {
  foundation: Foundation;
  world: World;
  storyGraph: StoryGraph;
  backbone: StoryBackbone;
  outline: Outline;
  supporting: SupportingEntities;
  items: Items;
  state: StateBundle;
}

const coreFileIds = ["brief", "outline", "world", "current-state", "foreshadowing"] as const;
type CoreFileId = typeof coreFileIds[number];
type CoreFileSources = Record<CoreFileId, string>;

interface WritingStyleSelection {
  id: string;
  versionId: string;
}

type InitializationModelPurpose = "planning" | "review";

interface InitializationDependencies {
  planningModel?: ModelConfigRecord;
  reviewModel?: ModelConfigRecord;
  generateText?: (
    paths: WorkspacePaths,
    model: ModelConfigRecord,
    input: ModelGenerateTextInput,
    purpose: InitializationModelPurpose
  ) => Promise<ModelGenerateTextResult>;
}

export async function initializeBookWithAi(
  paths: WorkspacePaths,
  context: RunExecutionContext,
  dependencies: InitializationDependencies = {}
) {
  const book = await getBook(paths, context.command.bookId);
  const sourceFiles = Object.fromEntries(await Promise.all(coreFileIds.map(async (fileId) => {
    const file = await getBookFileContent(paths, book.id, fileId);
    return [fileId, file.content] as const;
  }))) as CoreFileSources;
  const writingStyles = await listWritingStyles(paths);
  const availableWritingStyles = writingStyles
    .filter((style) => style.latestVersionId)
    .map((style) => ({
      id: style.id,
      name: style.name,
      summary: style.summary,
      latestVersionId: style.latestVersionId as string
  }));
  const models = await resolveModels(paths, dependencies);
  const generate = dependencies.generateText ?? ((
    generatePaths: WorkspacePaths,
    model: ModelConfigRecord,
    input: ModelGenerateTextInput,
    purpose: InitializationModelPurpose
  ) => generateModelTextWithFallback(generatePaths, model, input, { purpose }));
  const lockedFields = new Set(Object.keys(book).filter((field) => !book.needsAiFill.includes(field)));
  const baseContext = {
    currentBook: book,
    lockedFields: [...lockedFields],
    userBrief: sourceFiles.brief,
    authoritativeWorld: sourceFiles.world,
    availableWritingStyles
  };

  const foundation = await runStage(context, "foundation", foundationSchema, models.planning, generate, paths, {
    system: commonSystemPrompt("作品基础设置和故事基石"),
    user: `基于以下输入生成作品基础设置与故事基石。lockedFields 对应的当前值不得改变；needsAiFill 字段必须生成实际内容。writingStyleId 只能从 availableWritingStyles 中选择；没有候选时必须为 null。只输出 book-foundation.v1 JSON。\n${stringifyPrompt(baseContext)}`,
    maxTokens: 3_500
  });
  const normalizedFoundation = normalizeLockedBookFields(book, foundation);
  const writingStyle = resolveWritingStyleSelection(book, foundation.book.writingStyleId, availableWritingStyles);

  const world = await runStage(context, "world", worldSchema, models.planning, generate, paths, {
    system: commonSystemPrompt("小说世界观架构"),
    user: `根据故事基石生成世界骨架。authoritativeWorld 是用户权威设定，必须保留其事实，只补足缺口。ID 使用小写英文和连字符。只输出 book-world.v1 JSON。\n${stringifyPrompt({ foundation: normalizedFoundation, authoritativeWorld: sourceFiles.world })}`,
    maxTokens: 4_500
  });

  const factCards: FactCard[] = [
    ...extractFoundationFacts(book, normalizedFoundation),
    ...extractWorldFacts(world)
  ];

  const storyGraph = await runStage(context, "story_graph", storyGraphSchema, models.planning, generate, paths, {
    system: commonSystemPrompt("小说核心人物与势力关系"),
    user: appendFactContext(`生成只包含主角、核心对手、关键配角和核心势力的关系图。人物 factionIds 必须引用本次 factions 的 ID，关系端点必须存在。只输出 book-story-graph.v1 JSON。\n${stringifyPrompt({ foundation: normalizedFoundation, world })}`, factCards),
    maxTokens: 5_500
  });

  validateStoryGraph(storyGraph);

  const maxRepairRounds = 2;
  let repairIssues: string[] = [];

  for (let round = 0; round <= maxRepairRounds; round += 1) {
    const forceRegenerate = round > 0;
    const issues = round > 0 ? repairIssues : [];

    const backbone = await runStage(context, "story_backbone", storyBackboneSchema, models.planning, generate, paths, {
      system: commonSystemPrompt("小说关键事件时间线骨架"),
      user: appendRepairIssues(appendFactContext(`生成故事开篇时已经发生或正在进行的事件（startEvents）和贯穿全书的关键事件序列（keyEvents）。startEvents 是故事开始时读者应视为既成事实的内容（如主角已激活某系统、某人已失踪）；keyEvents 必须标注归属卷（volumeIndex）且同一事件只能出现一次；卷纲阶段只能延续本骨架，不得重新安排 startEvents。所有 relatedEntityIds 必须引用本次核心人物或势力 ID。只输出 book-story-backbone.v1 JSON。\n${stringifyPrompt({ foundation: normalizedFoundation, world, storyGraph })}`, factCards), issues),
      maxTokens: 4_000
    }, { forceRegenerate });

    verifyBackboneReferences(backbone, storyGraph);
    const roundFacts: FactCard[] = [...factCards, ...extractBackboneFacts(backbone)];

    const outline = await runOutlineStages(
      context,
      models.planning,
      generate,
      paths,
      { foundation: normalizedFoundation, world, storyGraph, backbone },
      roundFacts,
      issues,
      forceRegenerate
    );

    verifyBackboneOutlineConsistency(backbone, outline);

    const supporting = await runStage(context, "supporting_entities", supportingEntitiesSchema, models.planning, generate, paths, {
      system: commonSystemPrompt("小说地点与次要角色设定"),
      user: appendRepairIssues(appendFactContext(`按 requiredEntities 逐项生成地点和次要角色，不要增加无剧情用途的实体。regionId 必须引用世界 regions，controllerFactionId 和人物 factionIds 必须引用核心势力；firstUse 必须引用时间线骨架中已存在的事件，不得安排新的同类型事件。只输出 book-supporting-entities.v1 JSON。\n${stringifyPrompt({ world, storyGraph, backbone, outline })}`, roundFacts), issues),
      maxTokens: 6_000
    }, { forceRegenerate });

    validateSupporting(world, storyGraph, supporting);
    verifySupportingBackboneConsistency(supporting, backbone);

    const items = await runStage(context, "items", itemsSchema, models.planning, generate, paths, {
      system: commonSystemPrompt("小说关键物品设定"),
      user: appendRepairIssues(appendFactContext(`按 requiredEntities.items 生成关键物品。ownerEntityId 与 locationId 必须引用已存在实体；每个物品必须有限制和明确剧情用途。只输出 book-items.v1 JSON。\n${stringifyPrompt({ storyGraph, outline, supporting })}`, roundFacts), issues),
      maxTokens: 4_500
    }, { forceRegenerate });

    validateItems(storyGraph, supporting, items);

    const state = await runStage(context, "initial_state", stateBundleSchema, models.planning, generate, paths, {
      system: commonSystemPrompt("小说初始状态与伏笔规划"),
      user: appendRepairIssues(appendFactContext(`生成故事开篇时的权威状态和伏笔池。所有实体引用必须存在，伏笔投放必须早于回收；时间线骨架 startEvents 中已经发生的事件不得重复安排，卷纲中出现过的事件也不要重编。只输出 book-initial-state.v1 JSON。\n${stringifyPrompt({ foundation: normalizedFoundation, world, storyGraph, backbone, outline, supporting, items })}`, roundFacts), issues),
      maxTokens: 5_500
    }, { forceRegenerate });

    const bundle = { foundation: normalizedFoundation, world, storyGraph, backbone, outline, supporting, items, state } satisfies InitializationBundle;
    validateBundle(bundle);
    verifyOutlineStateConsistency(outline, state);
    verifyBackboneInitialStateConsistency(backbone, state);

    const review = await runStage(context, "consistency_review", reviewSchema, models.review, generate, paths, {
      system: commonSystemPrompt("小说初始化一致性审查"),
      user: appendRepairIssues(appendFactContext(`检查以下初始化 Bundle 是否存在阻断写入的硬冲突。只有悬空引用、违反锁定设定、与时间线骨架冲突、因果矛盾或时间顺序错误才标记 blocking。lockedBook 和 authoritativeSources 是不可覆盖的用户事实。只输出 book-initialization-review.v1 JSON。\n${stringifyPrompt({ lockedBook: book, authoritativeSources: { brief: sourceFiles.brief, world: sourceFiles.world }, bundle }, 45_000)}`, roundFacts), issues),
      maxTokens: 2_500,
      temperature: 0.1
    }, { forceRegenerate });

    const blockingIssues = review.issues
      .filter((issue) => issue.severity === "blocking")
      .map((issue) => issue.message);
    if (review.passed && blockingIssues.length === 0) {
      if (round > 0) context.emitProgress({ message: `一致性审查通过（第 ${round + 1} 轮修复后）。` });
      context.setStage("apply_bundle");
      context.emitProgress({ message: "一致性检查通过，正在自动写入作品信息。" });
      const applied = await applyInitializationBundle(
        paths,
        context.runId,
        book,
        bundle,
        sourceFiles,
        writingStyle,
        [...roundFacts, ...buildSummaryFactCards(bundle)],
        context.signal
      );
      const artifact = context.saveArtifact("book-initialization-bundle.v1", bundle);
      context.saveCheckpoint("apply_bundle", { artifactId: artifact.id, applied }, false);
      context.markCommitted?.();
      return {
        artifactType: "book_initialization_bundle",
        approvalRequired: false,
        bookId: book.id,
        generatedFiles: ["brief.md", "outline.md", "world.md", "state/current.md", "state/foreshadowing.md"],
        generatedEntities: applied.generatedEntities,
        review
      };
    }
    repairIssues = blockingIssues.length > 0 ? blockingIssues : [review.summary || "未说明具体问题"];
    if (round === maxRepairRounds) {
      context.emitProgress({ message: `一致性审查最终未通过，写入中止：${repairIssues.join("；")}` });
      throw new Error(`作品初始化一致性审查未通过：${repairIssues.join("；")}`);
    }
    context.emitProgress({ message: `一致性审查未通过，开始第 ${round + 1} 轮定向修复（最多 ${maxRepairRounds} 轮）。` });
  }

  throw new Error("作品初始化流程异常退出");
}

async function resolveModels(paths: WorkspacePaths, dependencies: InitializationDependencies) {
  if (dependencies.planningModel) {
    return { planning: dependencies.planningModel, review: dependencies.reviewModel ?? dependencies.planningModel };
  }
  const routes = await getModelRoutes(paths);
  if (!routes.planningModelId) throw new Error("未配置规划模型，无法自动生成作品信息");
  const planning = await getModelConfig(paths, routes.planningModelId);
  if (!planning.enabled) throw new Error("规划模型已停用，无法自动生成作品信息");
  const review = routes.reviewModelId ? await getModelConfig(paths, routes.reviewModelId) : planning;
  return { planning, review: review.enabled ? review : planning };
}

async function runStage<T>(
  context: RunExecutionContext,
  stage: string,
  schema: z.ZodType<T>,
  model: ModelConfigRecord,
  generate: NonNullable<InitializationDependencies["generateText"]>,
  paths: WorkspacePaths,
  prompt: { system: string; user: string; maxTokens: number; temperature?: number },
  options: { forceRegenerate?: boolean } = {}
) {
  context.setStage(stage);
  const artifactType = `book-initialization.${stage}.v1`;
  if (!options.forceRegenerate) {
    const cachedArtifact = context.loadArtifact(artifactType);
    if (cachedArtifact) {
      const cached = schema.safeParse(cachedArtifact.value);
      if (cached.success) {
        context.emitProgress({ message: `${stage} 已从检查点恢复`, artifactId: cachedArtifact.id });
        context.saveCheckpoint(stage, { artifactId: cachedArtifact.id, contentHash: cachedArtifact.contentHash }, true);
        return cached.data;
      }
    }
  }
  context.emitProgress({ message: `正在生成 ${stage}` });
  const purpose: InitializationModelPurpose = stage === "consistency_review" ? "review" : "planning";
  const outputContract = structuredOutputContract(schema);
  const request: ModelGenerateTextInput = {
    systemPrompt: `${prompt.system}\n\n${outputContract}`,
    userPrompt: prompt.user,
    temperature: prompt.temperature ?? 0.35,
    maxTokens: prompt.maxTokens,
    stream: true,
    timeoutMs: initializationStageTimeoutMs,
    responseFormat: "json_object"
  };
  let result = await generate(paths, model, request, purpose);
  let parsed = parseStructuredResult(schema, result.text);
  if (!parsed.success) {
    result = await generate(paths, model, {
      systemPrompt: `${prompt.system}\n\n上次输出未通过结构校验。必须依据校验错误修复全部字段，只输出一个完整 JSON 对象，不添加解释。\n校验错误：${parsed.error.slice(0, 8_000)}\n\n${outputContract}`,
      userPrompt: `原始任务：\n${prompt.user.slice(0, 45_000)}\n\n上次无效输出：\n${result.text.slice(0, 35_000)}`,
      temperature: 0,
      maxTokens: prompt.maxTokens,
      stream: true,
      timeoutMs: initializationStageTimeoutMs,
      responseFormat: "json_object"
    }, purpose);
    parsed = parseStructuredResult(schema, result.text);
  }
  if (!parsed.success) throw new Error(`${stage} 结构化输出校验失败：${parsed.error}`);
  const artifact = context.saveArtifact(artifactType, parsed.data);
  context.saveCheckpoint(stage, { artifactId: artifact.id, contentHash: artifact.contentHash }, true);
  context.emitProgress({ message: `${stage} 已生成并通过结构校验`, artifactId: artifact.id });
  return parsed.data;
}

async function runOutlineStages(
  context: RunExecutionContext,
  model: ModelConfigRecord,
  generate: NonNullable<InitializationDependencies["generateText"]>,
  paths: WorkspacePaths,
  input: { foundation: Foundation; world: World; storyGraph: StoryGraph; backbone: StoryBackbone },
  factCards: FactCard[],
  repairIssues: string[] = [],
  forceRegenerate = false
): Promise<Outline> {
  const cachedArtifact = forceRegenerate ? null : context.loadArtifact("book-initialization.outline.v1");
  if (cachedArtifact) {
    const cached = outlineSchema.safeParse(cachedArtifact.value);
    if (cached.success) {
      context.setStage("outline");
      context.emitProgress({ message: "outline 已从检查点恢复", artifactId: cachedArtifact.id });
      context.saveCheckpoint("outline", { artifactId: cachedArtifact.id, contentHash: cachedArtifact.contentHash }, true);
      return cached.data;
    }
  }

  const plan: OutlinePlan = await runStage(context, "outline_plan", outlinePlanSchema, model, generate, paths, {
    system: commonSystemPrompt("长篇小说总纲与分卷规划"),
    user: appendRepairIssues(appendFactContext(`生成全书主线与分卷推进，不生成实体清单。预计章节数应与 plannedWords/chapterWords 基本一致；分卷数量应为支撑剧情所需的最少数量，每项内容保持简洁具体。卷纲必须延续 story_backbone：keyEvents 按其 volumeIndex 归属各卷，startEvents 中已经发生的事件不得重新安排。只输出 book-outline-plan.v1 JSON。\n${stringifyPrompt(input)}`, factCards), repairIssues),
    maxTokens: 4_200
  }, { forceRegenerate });
  const requirements: EntityRequirements = await runStage(context, "entity_requirements", entityRequirementsSchema, model, generate, paths, {
    system: commonSystemPrompt("小说剧情实体需求规划"),
    user: appendRepairIssues(appendFactContext(`根据已完成的分卷规划，生成确有剧情用途的地点、次要角色和关键物品需求。不要生成完整设定，只列出后续阶段必须补全的最少实体；ID 使用小写英文和连字符。只输出 book-entity-requirements.v1 JSON。\n${stringifyPrompt({ world: input.world, storyGraph: input.storyGraph, outlinePlan: plan })}`, factCards), repairIssues),
    maxTokens: 3_200
  }, { forceRegenerate });
  verifyRequirementsBackboneConsistency(requirements, input.backbone);
  const outline = outlineSchema.parse({
    schemaVersion: "book-outline.v1",
    mainLine: plan.mainLine,
    estimatedChapters: plan.estimatedChapters,
    volumes: plan.volumes,
    requiredEntities: requirements.requiredEntities
  });

  context.setStage("outline");
  const artifact = context.saveArtifact("book-initialization.outline.v1", outline);
  context.saveCheckpoint("outline", { artifactId: artifact.id, contentHash: artifact.contentHash }, true);
  context.emitProgress({ message: "outline 已生成并通过结构校验", artifactId: artifact.id });
  return outline;
}

function structuredOutputContract(schema: z.ZodTypeAny) {
  return [
    "输出必须完整匹配下面的 JSON Schema：所有 required 字段都必须出现，不得使用占位值，不得输出 Schema 本身。",
    JSON.stringify(toPromptJsonSchema(schema), null, 2)
  ].join("\n");
}

function toPromptJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    return {
      type: "object",
      required: Object.entries(shape).filter(([, field]) => !field.isOptional()).map(([name]) => name),
      additionalProperties: false,
      properties: Object.fromEntries(Object.entries(shape).map(([name, field]) => [name, toPromptJsonSchema(field)]))
    };
  }
  if (schema instanceof z.ZodString) {
    const contract: Record<string, unknown> = { type: "string" };
    for (const check of schema._def.checks) {
      if (check.kind === "min") contract.minLength = check.value;
      if (check.kind === "max") contract.maxLength = check.value;
      if (check.kind === "regex") contract.pattern = check.regex.source;
    }
    return contract;
  }
  if (schema instanceof z.ZodNumber) {
    const contract: Record<string, unknown> = { type: "number" };
    for (const check of schema._def.checks) {
      if (check.kind === "int") contract.type = "integer";
      if (check.kind === "min") contract[check.inclusive ? "minimum" : "exclusiveMinimum"] = check.value;
      if (check.kind === "max") contract[check.inclusive ? "maximum" : "exclusiveMaximum"] = check.value;
    }
    return contract;
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: "boolean" };
  }
  if (schema instanceof z.ZodArray) {
    const contract: Record<string, unknown> = { type: "array", items: toPromptJsonSchema(schema.element) };
    if (schema._def.minLength) contract.minItems = schema._def.minLength.value;
    if (schema._def.maxLength) contract.maxItems = schema._def.maxLength.value;
    return contract;
  }
  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: schema.options };
  }
  if (schema instanceof z.ZodLiteral) {
    const value = schema.value;
    return { type: value === null ? "null" : typeof value, const: value };
  }
  if (schema instanceof z.ZodNullable) {
    return { anyOf: [toPromptJsonSchema(schema.unwrap()), { type: "null" }] };
  }
  throw new Error(`无法为作品初始化字段生成 JSON Schema：${schema._def.typeName}`);
}

function parseStructuredResult<T>(schema: z.ZodType<T>, text: string): { success: true; data: T } | { success: false; error: string } {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < start) return { success: false, error: "响应中没有 JSON 对象" };
    return { success: true, data: schema.parse(JSON.parse(text.slice(start, end + 1))) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function commonSystemPrompt(role: string) {
  return `你是${role}。严格根据输入工作，不覆盖用户锁定事实，不使用“待补充”或占位文本。所有 ID 使用小写英文字母、数字和连字符。只输出合法 JSON。`;
}

/**
 * 前序产物序列化注入：默认 30_000 字符（约 1 万 token）上限——太短缺少背景易答非所问，
 * 太长噪声与冲突上升；前情必要内容由【不可变事实】+【已确认设定摘要】两个分片补充，
 * 这里只保留本阶段直接依赖的结构化产物。
 */
function stringifyPrompt(value: unknown, limit = 30_000) {
  const serialized = JSON.stringify(value);
  return serialized.length <= limit ? serialized : serialized.slice(0, limit);
}

function validateStoryGraph(graph: StoryGraph) {
  const ids = new Set([...graph.characters.map((item) => item.id), ...graph.factions.map((item) => item.id)]);
  assertUnique(ids.size, graph.characters.length + graph.factions.length, "核心人物和势力 ID 重复");
  for (const character of graph.characters) {
    for (const factionId of character.factionIds) assertReference(ids, factionId, `人物 ${character.name} 引用了不存在的势力`);
  }
  for (const relation of graph.relationships) {
    assertReference(ids, relation.fromId, "关系起点不存在");
    assertReference(ids, relation.toId, "关系终点不存在");
  }
}

function validateSupporting(world: World, graph: StoryGraph, supporting: SupportingEntities) {
  const regionIds = new Set(world.regions.map((item) => item.id));
  const factionIds = new Set(graph.factions.map((item) => item.id));
  const existingIds = new Set([...graph.characters.map((item) => item.id), ...factionIds]);
  for (const location of supporting.locations) {
    assertReference(regionIds, location.regionId, `地点 ${location.name} 引用了不存在的区域`);
    if (location.controllerFactionId) assertReference(factionIds, location.controllerFactionId, `地点 ${location.name} 引用了不存在的势力`);
    if (existingIds.has(location.id)) throw new Error(`补充实体 ID 与核心实体冲突：${location.id}`);
    existingIds.add(location.id);
  }
  for (const character of supporting.supportingCharacters) {
    if (existingIds.has(character.id)) throw new Error(`补充实体 ID 重复：${character.id}`);
    for (const factionId of character.factionIds) assertReference(factionIds, factionId, `人物 ${character.name} 引用了不存在的势力`);
    existingIds.add(character.id);
  }
}

function validateItems(graph: StoryGraph, supporting: SupportingEntities, items: Items) {
  const ownerIds = new Set([
    ...graph.characters.map((item) => item.id),
    ...graph.factions.map((item) => item.id),
    ...supporting.supportingCharacters.map((item) => item.id)
  ]);
  const locationIds = new Set(supporting.locations.map((item) => item.id));
  const itemIds = new Set<string>();
  for (const item of items.items) {
    if (itemIds.has(item.id) || ownerIds.has(item.id) || locationIds.has(item.id)) throw new Error(`物品 ID 重复：${item.id}`);
    if (item.ownerEntityId) assertReference(ownerIds, item.ownerEntityId, `物品 ${item.name} 的所有者不存在`);
    if (item.locationId) assertReference(locationIds, item.locationId, `物品 ${item.name} 的地点不存在`);
    itemIds.add(item.id);
  }
}

function validateBundle(bundle: InitializationBundle) {
  const entityIds = new Set([
    ...bundle.storyGraph.characters.map((item) => item.id),
    ...bundle.storyGraph.factions.map((item) => item.id),
    ...bundle.supporting.locations.map((item) => item.id),
    ...bundle.supporting.supportingCharacters.map((item) => item.id),
    ...bundle.items.items.map((item) => item.id)
  ]);
  for (const state of bundle.state.characterStates) assertReference(entityIds, state.characterId, "人物状态引用不存在");
  for (const state of bundle.state.factionStates) assertReference(entityIds, state.factionId, "势力状态引用不存在");
  for (const state of bundle.state.itemStates) assertReference(entityIds, state.itemId, "物品状态引用不存在");
  for (const foreshadowing of bundle.state.foreshadowing) {
    for (const entityId of foreshadowing.relatedEntityIds) assertReference(entityIds, entityId, "伏笔引用不存在");
  }
}

function assertReference(ids: Set<string>, id: string, message: string) {
  if (!ids.has(id)) throw new Error(`${message}：${id}`);
}

function assertUnique(actual: number, expected: number, message: string) {
  if (actual !== expected) throw new Error(message);
}

async function applyInitializationBundle(
  paths: WorkspacePaths,
  runId: string,
  originalBook: BookRecord,
  bundle: InitializationBundle,
  sourceFiles: CoreFileSources,
  writingStyle: WritingStyleSelection | null,
  factCards: FactCard[],
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const currentBook = await getBook(paths, originalBook.id);
  if (currentBook.updatedAt !== originalBook.updatedAt) throw new Error("生成期间作品基础信息已被修改，已停止自动覆盖");
  const fileSnapshot = await captureBookFilesSnapshot(paths, originalBook.id, coreFileIds);
  for (const file of fileSnapshot.contents) {
    if (file.content !== sourceFiles[file.fileId as CoreFileId]) {
      const metadata = fileSnapshot.files.find((item) => item.id === file.fileId);
      throw new Error(`生成期间核心文件已被修改，已停止自动覆盖：${metadata?.path ?? file.fileId}`);
    }
  }
  const entitySnapshot = await captureEntityStorageSnapshot(paths, originalBook.id);
  signal.throwIfAborted();
  const backupDir = path.join(paths.backupsDir, "initializations", originalBook.id);
  await ensureDirectory(backupDir);
  await writeJsonFile(path.join(backupDir, `${runId}.json`), {
    book: originalBook,
    files: Object.fromEntries(fileSnapshot.contents.map((file) => [file.fileId, file.content])),
    fileIndex: fileSnapshot.files,
    entities: entitySnapshot.entities,
    entityFiles: entitySnapshot.files
  });

  const markdown = {
    brief: preserveAuthoritativeSource(
      renderBrief(bundle.foundation),
      "用户原始创作简述",
      sourceFiles.brief,
      !originalBook.needsAiFill.includes("brief")
    ),
    outline: renderOutline(bundle.outline),
    world: preserveAuthoritativeSource(
      renderWorld(bundle.world),
      "用户权威世界观原文",
      sourceFiles.world,
      isAuthoritativeWorldSource(sourceFiles.world)
    ),
    "current-state": renderCurrentState(bundle.state),
    foreshadowing: renderForeshadowing(bundle.state)
  };
  const nextBook: BookRecord = {
    ...currentBook,
    title: chooseGenerated(currentBook, "title", bundle.foundation.book.title),
    genre: chooseGenerated(currentBook, "genre", bundle.foundation.book.genre),
    narrationPerspective: chooseGenerated(currentBook, "narrationPerspective", bundle.foundation.book.narrationPerspective),
    channel: chooseGenerated(currentBook, "channel", bundle.foundation.book.channel),
    protagonistGender: chooseGenerated(currentBook, "protagonistGender", bundle.foundation.book.protagonistGender),
    protagonistName: chooseGenerated(currentBook, "protagonistName", bundle.foundation.book.protagonistName),
    plannedWords: chooseGenerated(currentBook, "plannedWords", bundle.foundation.book.plannedWords),
    chapterWords: chooseGenerated(currentBook, "chapterWords", bundle.foundation.book.chapterWords),
    writingStyleId: currentBook.needsAiFill.includes("writingStyleId")
      ? writingStyle?.id ?? null
      : currentBook.writingStyleId,
    writingStyleVersionId: currentBook.needsAiFill.includes("writingStyleId")
      ? writingStyle?.versionId ?? null
      : currentBook.writingStyleVersionId,
    needsAiFill: currentBook.needsAiFill.filter((field) =>
      ["writingStyleId", "writingStyleVersionId"].includes(field) && writingStyle === null
    ),
    status: "drafting",
    updatedAt: new Date().toISOString()
  };
  const generatedEntities = toGeneratedEntities(bundle);

  try {
    for (const fileId of coreFileIds) {
      signal.throwIfAborted();
      await updateBookFileContent(paths, originalBook.id, fileId, { content: markdown[fileId] });
    }
    signal.throwIfAborted();
    await saveBook(paths, nextBook);
    signal.throwIfAborted();
    await replaceGeneratedEntities(paths, originalBook.id, generatedEntities);
    signal.throwIfAborted();
    await writeFactCards(paths, originalBook.id, factCards);
    signal.throwIfAborted();
  } catch (error) {
    const rollback = await Promise.allSettled([
      restoreBookFilesSnapshot(paths, originalBook.id, fileSnapshot),
      saveBook(paths, originalBook),
      restoreEntityStorageSnapshot(paths, originalBook.id, entitySnapshot, generatedEntities)
    ]);
    const rollbackErrors = rollback
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], "作品初始化写入失败，且补偿回滚未完全成功");
    }
    throw error;
  }
  return { generatedEntities: generatedEntities.length };
}

function resolveWritingStyleSelection(
  book: BookRecord,
  generatedStyleId: string | null,
  availableStyles: Array<{ id: string; latestVersionId: string }>
): WritingStyleSelection | null {
  if (!book.needsAiFill.includes("writingStyleId")) {
    return book.writingStyleId && book.writingStyleVersionId
      ? { id: book.writingStyleId, versionId: book.writingStyleVersionId }
      : null;
  }
  if (!generatedStyleId) return null;
  const selected = availableStyles.find((style) => style.id === generatedStyleId);
  if (!selected) throw new Error(`AI 选择了不存在或没有可用版本的写作风格：${generatedStyleId}`);
  return { id: selected.id, versionId: selected.latestVersionId };
}

function chooseGenerated<K extends keyof Pick<BookRecord, "title" | "genre" | "narrationPerspective" | "channel" | "protagonistGender" | "protagonistName" | "plannedWords" | "chapterWords">>(
  book: BookRecord,
  field: K,
  generated: BookRecord[K]
) {
  return book.needsAiFill.includes(field) ? generated : book[field];
}

function toGeneratedEntities(bundle: InitializationBundle): GeneratedEntityInput[] {
  const characters = [...bundle.storyGraph.characters, ...bundle.supporting.supportingCharacters].map((item) => ({
    id: item.id,
    entityType: "character" as const,
    name: item.name,
    role: item.role,
    description: `${item.identity}；目标：${item.goal}；动机：${item.motivation}；弱点：${item.weakness}；成长：${item.arc}`,
    attributes: item
  }));
  const factions = bundle.storyGraph.factions.map((item) => ({
    id: item.id,
    entityType: "faction" as const,
    name: item.name,
    role: item.role,
    description: `${item.goal}；内部矛盾：${item.internalConflict}`,
    attributes: item
  }));
  const locations = bundle.supporting.locations.map((item) => ({
    id: item.id,
    entityType: "location" as const,
    name: item.name,
    role: item.role,
    description: item.description,
    attributes: item
  }));
  const items = bundle.items.items.map((item) => ({
    id: item.id,
    entityType: "item" as const,
    name: item.name,
    role: item.role,
    description: item.description,
    attributes: item
  }));
  return [...characters, ...factions, ...locations, ...items];
}

function renderBrief(value: Foundation) {
  return `# 故事基石\n\n## 作品定位\n- 名称：${value.book.title}\n- 题材：${value.book.genre}\n- 叙事人称：${value.book.narrationPerspective}\n- 频道：${value.book.channel}\n\n## 核心前提\n${value.premise}\n\n## 核心冲突\n${value.coreConflict}\n\n## 主角目标\n${value.protagonistGoal}\n\n## 失败代价\n${value.stakes}\n\n## 主题\n${markdownList(value.themes)}\n\n## 核心卖点\n${markdownList(value.sellingPoints)}\n\n## 读者承诺\n${markdownList(value.readerPromises)}\n\n## 创作边界\n${markdownList(value.boundaries)}\n`;
}

function renderWorld(value: World) {
  return `# 世界观\n\n## 总览\n${value.overview}\n\n## 时代\n${value.era}\n\n## 社会结构\n${value.society}\n\n## 世界规则\n${value.rules.map((rule) => `### ${rule.name}\n${rule.description}\n\n- 限制：${rule.limitation}\n- 代价：${rule.cost}`).join("\n\n")}\n\n## 力量体系\n${value.powerSystems.map((system) => `### ${system.name}\n${system.description}\n\n- 限制：${system.limitation}`).join("\n\n")}\n\n## 历史背景\n${markdownList(value.history)}\n\n## 主要区域\n${value.regions.map((region) => `- **${region.name}**（${region.id}）：${region.summary}`).join("\n")}\n\n## 冲突来源\n${markdownList(value.conflictSources)}\n`;
}

function renderOutline(value: Outline) {
  return `# 总纲与卷纲规划\n\n## 全书主线\n${value.mainLine}\n\n## 预计章节\n${value.estimatedChapters} 章\n\n${value.volumes.map((volume, index) => `## 第 ${index + 1} 卷：${volume.title}\n\n- 目标：${volume.goal}\n- 冲突：${volume.conflict}\n- 转折：${volume.turningPoint}\n- 高潮：${volume.climax}\n- 收束：${volume.resolution}\n\n### 人物变化\n${markdownList(volume.characterChanges)}\n\n### 伏笔计划\n${markdownList(volume.foreshadowing)}`).join("\n\n")}\n`;
}

function renderCurrentState(value: StateBundle) {
  return `# 当前状态\n\n## 故事起点\n${value.storyStart}\n\n## 已公开信息\n${markdownList(value.publicFacts)}\n\n## 未公开秘密\n${markdownList(value.secrets)}\n\n## 下一阶段目标\n${markdownList(value.nextGoals)}\n\n## 人物状态\n${value.characterStates.map((item) => `- **${item.characterId}**：${item.state}`).join("\n")}\n\n## 势力状态\n${value.factionStates.map((item) => `- **${item.factionId}**：${item.state}`).join("\n")}\n\n## 物品状态\n${value.itemStates.map((item) => `- **${item.itemId}**：${item.state}`).join("\n")}\n`;
}

function renderForeshadowing(value: StateBundle) {
  return `# 伏笔池\n\n| ID | 伏笔 | 关联实体 | 投放计划 | 回收计划 | 状态 |\n| --- | --- | --- | --- | --- | --- |\n${value.foreshadowing.map((item) => `| ${item.id} | ${escapeTable(item.content)} | ${item.relatedEntityIds.join("、")} | ${escapeTable(item.placement)} | ${escapeTable(item.resolution)} | ${item.status} |`).join("\n")}\n`;
}

function markdownList(items: string[]) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- 无";
}

function escapeTable(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function preserveAuthoritativeSource(generated: string, heading: string, source: string, preserve: boolean) {
  if (!preserve || !source.trim()) return generated;
  return `${generated.trimEnd()}\n\n# ${heading}\n\n${source.trim()}\n`;
}

function isAuthoritativeWorldSource(source: string) {
  return !source.includes("待 AI 根据作品简介、题材和角色方向生成 world.md。")
    && !source.includes("已记录用户上传的世界观文件：");
}

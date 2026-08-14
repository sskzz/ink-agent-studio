import path from "node:path";
import { rm } from "node:fs/promises";
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
import {
  createInitialStoryPlan,
  createInitialWorldRuleRegistry,
  normalizeCharacterProfile,
  writeStoryPlan,
  writeWorldRuleRegistry
} from "../books/storyKnowledgeRepository.js";
import { listWritingStyles } from "../styles/writingStyleService.js";
import type { BookRecord, ModelConfigRecord } from "../../types/domain.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { ensureDirectory, pathExists, readTextFile, writeTextFileAtomic } from "../../utils/fileStore.js";
import { writeJsonFile } from "../../utils/jsonStore.js";
import type { RunExecutionContext } from "./runCoordinator.js";
import { writeFactCards } from "../books/factRepository.js";
import type { FactCard } from "../../schemas/factSchemas.js";
import {
  createBaselineRuntimeState,
  renderCurrentStateMarkdown,
  renderForeshadowingMarkdown,
  stateControlFilePaths,
  writeControlFile,
  writeRuntimeState
} from "../books/runtimeStateRepository.js";
import {
  appendFactContext,
  appendRepairIssues,
  assertUniqueEntityIds,
  buildEntityIdRegistry,
  buildSummaryFactCards,
  collectEventReferenceIssues,
  collectForeshadowingScopeIssues,
  collectInitializationReferenceIssues,
  collectNumberDriftIssues,
  extractBackboneFacts,
  extractFoundationFacts,
  extractItemFacts,
  extractStateFacts,
  extractSupportingFacts,
  extractVolumeNumber,
  extractWorldFacts,
  normalizeLockedBookFields,
  verifyBackboneInitialStateConsistency,
  verifyBackboneOutlineConsistency,
  verifyBackboneReferences,
  verifyOutlineStateConsistency,
  verifyRequirementsBackboneConsistency,
  verifySupportingBackboneConsistency
} from "./initializationFacts.js";
import { createBookPaths } from "../books/bookPaths.js";

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
    // 姓名语义约束：只允许姓名常用字符（汉字、字母、数字、间隔点），
    // 禁止括号、逗号、句号等标点——防止模型把解释性文字（如"（化名，班里同学常记错名字）"）
    // 塞进姓名字段。max(20) 对真实姓名绰绰有余，超长或含标点都视为违反契约，走重试/修复轮。
    protagonistName: z.string().trim().min(1).max(20).regex(
      /^[^（）()，,。；;、：:]+$/,
      "主角姓名只能包含姓名本身，禁止括号、逗号、句号等解释性标点"
    ),
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
  factionIds: z.array(identifierSchema).max(5),
  /** 五层角色模型的可选生成字段；旧模型响应不含这些字段时由归一化器补空值。 */
  appearance: z.string().trim().max(500).optional(),
  personalityTraits: z.array(shortText).max(12).optional(),
  values: z.array(shortText).max(12).optional(),
  prohibitedActions: z.array(shortText).max(12).optional(),
  voice: z.string().trim().max(300).optional(),
  sentenceRhythm: z.string().trim().max(200).optional(),
  signaturePhrases: z.array(z.string().trim().min(1).max(100)).max(12).optional(),
  forbiddenExpressions: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  subtextHabits: z.array(shortText).max(12).optional()
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
  // 卷名语义约束：不得以"第 N 卷"开头（前缀由渲染层统一添加），
  // 用 lookahead 正则实现"拒绝型"模式；不用 refine 是因为 toPromptJsonSchema
  // 无法为 ZodEffects 生成 JSON Schema，而 regex 是 ZodString 的内置 check。
  title: shortText.regex(/^(?!第[一二三四五六七八九十百\d]+卷)/, "卷名不得以「第 N 卷」开头，只写卷名本身"),
  goal: shortText,
  conflict: shortText,
  turningPoint: shortText,
  climax: shortText,
  resolution: shortText,
  // 卷纲已取消独立的"伏笔计划"字段：全书伏笔统一由伏笔池（initial_state 阶段）登记，
  // 卷纲渲染时按投放卷引用伏笔池内容（renderOutline 实现），避免两套伏笔体系割裂。
  characterChanges: textList
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
    status: z.enum(["planned", "planted", "resolving", "resolved"]),
    horizon: z.enum(["short", "long"]).optional(),
    targetChapterRange: z.object({
      start: z.number().int().min(1).max(1_000),
      end: z.number().int().min(1).max(1_000)
    }).optional()
  })).min(1).max(40)
});

const reviewSchema = z.object({
  schemaVersion: z.literal("book-initialization-review.v1"),
  passed: z.boolean(),
  issues: z.array(z.object({
    severity: z.enum(["warning", "blocking"]),
    message: shortText,
    // 证据字段：blocking 问题必须附上两处冲突内容的原文引用与位置，
    // 防止审查模型给出"抽象判定"或幻觉证据，也便于修复轮定向修改。
    evidence: z.string().max(600).optional()
  })).max(20),
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
    user: `基于以下输入生成作品基础设置与故事基石。lockedFields 对应的当前值不得改变；needsAiFill 字段必须生成实际内容。protagonistName 只填姓名本身（如「苏见」），禁止括号、标点或任何解释性文字；各字段内容必须符合字段语义，不得把设定说明塞进单个字段。writingStyleId 只能从 availableWritingStyles 中选择；没有候选时必须为 null。只输出 book-foundation.v1 JSON。\n${stringifyPrompt(baseContext)}`,
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

  const maxRepairRounds = 2;
  let repairIssues: string[] = [];

  for (let round = 0; round <= maxRepairRounds; round += 1) {
    const issues = round > 0 ? repairIssues : [];
    // 定向修复：根据本轮问题清单判定需要重生成的阶段，未受损阶段从检查点恢复，
    // 避免"一处引用错误就整轮重写"带来新的偏差与额外模型调用成本。
    const targets = round > 0 ? classifyRepairTargets(issues) : new Set<RepairTarget>();
    const forceBackbone = targets.has("story_backbone");
    const forceOutline = targets.has("outline") || forceBackbone;
    const forceSupporting = targets.has("supporting_entities") || forceOutline;
    const forceItems = targets.has("items") || forceSupporting;
    const forceState = targets.has("initial_state") || forceItems;

    const backbone = await runStage(context, "story_backbone", storyBackboneSchema, models.planning, generate, paths, {
      system: commonSystemPrompt("小说关键事件时间线骨架"),
      user: appendRepairIssues(appendFactContext(`生成故事开篇时已经发生或正在进行的事件（startEvents）和贯穿全书的关键事件序列（keyEvents）。startEvents 是故事开始时读者应视为既成事实的内容（如主角已激活某系统、某人已失踪），事件 id 使用 st-X 格式；keyEvents 必须标注归属卷（volumeIndex）且同一事件只能出现一次，事件 id 使用 ke-卷号-序号 格式（如 ke-3-2），供后续阶段引用；卷纲阶段只能延续本骨架，不得重新安排 startEvents。所有 relatedEntityIds 必须引用本次核心人物或势力 ID。只输出 book-story-backbone.v1 JSON。\n${stringifyPrompt({ foundation: normalizedFoundation, world, storyGraph }, 30_000, ["foundation", "world", "storyGraph"])}`, factCards), issues),
      maxTokens: 4_000
    }, { forceRegenerate: forceBackbone });

    verifyBackboneReferences(backbone, storyGraph);
    const backboneFacts = extractBackboneFacts(backbone);
    const outlineFacts: FactCard[] = [...factCards, ...backboneFacts];

    const outline = await runOutlineStages(
      context,
      models.planning,
      generate,
      paths,
      { foundation: normalizedFoundation, world, storyGraph, backbone },
      outlineFacts,
      issues,
      forceOutline
    );

    verifyBackboneOutlineConsistency(backbone, outline);

    const supporting = await runStage(context, "supporting_entities", supportingEntitiesSchema, models.planning, generate, paths, {
      system: commonSystemPrompt("小说地点与次要角色设定"),
      user: appendRepairIssues(appendFactContext(`按 requiredEntities 逐项生成地点和次要角色，不要增加无剧情用途的实体。regionId 必须引用世界 regions，controllerFactionId 和人物 factionIds 必须引用核心势力；firstUse 必须引用时间线骨架中已存在的事件，不得安排新的同类型事件。identity/description 描述的是故事开局时的现状：尚未发生的事件（如未来的受伤、发现、改变）只能写入 firstUse 或 arc，不得写成既成事实。只输出 book-supporting-entities.v1 JSON。\n${stringifyPrompt({ world, storyGraph, backbone, outline }, 30_000, ["backbone", "outline", "world"])}`, outlineFacts), issues),
      maxTokens: 6_000
    }, { forceRegenerate: forceSupporting });

    verifySupportingBackboneConsistency(supporting, backbone);
    const supportingFacts = extractSupportingFacts(supporting);

    const items = await runStage(context, "items", itemsSchema, models.planning, generate, paths, {
      system: commonSystemPrompt("小说关键物品设定"),
      user: appendRepairIssues(appendFactContext(`按 requiredEntities.items 生成关键物品。ownerEntityId 与 locationId 必须引用已存在实体；每个物品必须有限制和明确剧情用途。只输出 book-items.v1 JSON。\n${stringifyPrompt({ storyGraph, outline, supporting }, 30_000, ["supporting", "outline"])}`, [...outlineFacts, ...supportingFacts]), issues),
      maxTokens: 4_500
    }, { forceRegenerate: forceItems });
    const itemsFacts = extractItemFacts(items);

    // 可引用实体 ID 白名单：防止 initial_state 阶段“发明”不存在的物品/角色 ID 造成悬空引用。
    const entityRegistry = buildEntityIdRegistry({ storyGraph, supporting, items });

    const state = await runStage(context, "initial_state", stateBundleSchema, models.planning, generate, paths, {
      system: commonSystemPrompt("小说初始状态与伏笔规划"),
      user: appendRepairIssues(appendFactContext(`【开场事件（storyStart 只能扩写以下事件，不得增加骨架中不存在的新人物身份、地点设定、数字或事件；伏笔引用事件时写明事件标题或 ke-卷号-序号 id）】\n${renderStartEvents(backbone)}\n\n【伏笔池规划要求（伏笔池是全书唯一体系，按 horizon 区分 long/short：长线须跨章或跨卷，短线须在邻近章节回收；每条伏笔须在投放计划与回收计划中标注所属卷号或 ke-卷号-序号事件引用，能确定章节时必须填写 targetChapterRange，范围为 1-${outline.estimatedChapters}；投放必须早于回收；须包含跨卷长线伏笔并覆盖结局卷；开场已埋设的伏笔 status 用 planted，其余用 planned）】\n\n【可引用实体 ID（characterStates/factionStates/itemStates/relatedEntityIds 只能引用以下 ID，不得发明新 ID）】\n${entityRegistry}\n\n生成故事开篇时的权威状态和伏笔池。所有实体引用必须存在，投放与回收计划中引用的骨架事件必须真实存在；时间线骨架 startEvents 中已经发生的事件不得重复安排。只输出 book-initial-state.v1 JSON。\n${stringifyPrompt({ foundation: normalizedFoundation, world, storyGraph, backbone, outline, supporting, items }, 40_000, ["backbone", "supporting", "outline", "items"])}`, [...outlineFacts, ...supportingFacts, ...itemsFacts]), issues),
      maxTokens: 5_500
    }, { forceRegenerate: forceState });

    const bundle = { foundation: normalizedFoundation, world, storyGraph, backbone, outline, supporting, items, state } satisfies InitializationBundle;
    // 结构性错误（ID 重复）直接失败；事件去重类确定性校验直接失败。
    assertUniqueEntityIds(bundle);
    verifyOutlineStateConsistency(outline, state);
    verifyBackboneInitialStateConsistency(backbone, state);

    // 引用完整性 / 事件引用 / 数字与时态忠实度 / 伏笔池长线覆盖错误属于生成偏差：
    // 收集全部问题回注给下一轮定向重生成修复（与审查失败共用修复轮）。
    const referenceIssues = [
      ...collectInitializationReferenceIssues(bundle),
      ...collectEventReferenceIssues(bundle),
      ...collectNumberDriftIssues(bundle),
      ...collectForeshadowingScopeIssues(bundle)
    ];
    if (referenceIssues.length > 0) {
      repairIssues = referenceIssues;
      if (round === maxRepairRounds) {
        context.emitProgress({ message: `作品初始化引用与事实一致性校验最终未通过，写入中止：${repairIssues.join("；")}` });
        throw new Error(`作品初始化引用与事实一致性校验未通过：${repairIssues.join("；")}`);
      }
      context.emitProgress({ message: `引用与事实一致性校验未通过（${referenceIssues.length} 处），开始第 ${round + 1} 轮定向修复（最多 ${maxRepairRounds} 轮）。` });
      continue;
    }

    // 一致性审查拆分为三次聚焦审查：实体 vs 初始状态、事实忠实度（数字/时态/事件引用）、
    // 全局硬冲突（锁定设定/边界承诺）。每次输入远小于旧的单次 45K 全量审查，
    // 模型能读全内容；blocking 必须附证据原文，漏检与幻觉判定概率显著下降。
    const stateFacts = extractStateFacts(state);
    const entityStateReview = await runStage(context, "review_entity_state", reviewSchema, models.review, generate, paths, {
      system: commonSystemPrompt("小说实体设定与初始状态交叉审查"),
      user: appendRepairIssues(`检查实体设定（角色/势力/地点/物品的 identity/description）与初始状态（故事起点、人物/势力/物品状态、伏笔池）之间是否存在互斥。只有以下情况标记 blocking：实体身份把尚未发生的事件写成既成事实、同一实体的描述与对应状态直接矛盾、时态或因果冲突。每条 blocking 必须附上冲突两处的原文引用作为 evidence（evidence 只写原文，不要复述或解释）。只输出 book-initialization-review.v1 JSON。\n${stringifyPrompt({ supporting, items, state }, 16_000, ["state", "supporting"])}`, issues),
      maxTokens: 2_500,
      temperature: 0.1
    }, { forceRegenerate: round > 0 });

    const factFidelityReview = await runStage(context, "review_fact_fidelity", reviewSchema, models.review, generate, paths, {
      system: commonSystemPrompt("小说事实忠实度审查"),
      user: appendRepairIssues(appendFactContext(`检查骨架事件、卷纲与初始状态之间的事实一致性。只有以下情况标记 blocking：同一事实在不同来源中的数字或时态互相矛盾（如「已连续打卡 200 天」与「即将达到 200 天」）、伏笔文本引用了不存在的骨架事件、故事起点发明了骨架中不存在的新事件或新设定、伏笔池未覆盖到结局卷或缺少跨卷长线伏笔（逐条核对伏笔池的投放/回收卷号标注与全书卷数）。每条 blocking 必须附上冲突两处的原文引用作为 evidence。只输出 book-initialization-review.v1 JSON。\n${stringifyPrompt({ outline, state }, 16_000, ["state", "outline"])}`, backboneFacts), issues),
      maxTokens: 2_500,
      temperature: 0.1
    }, { forceRegenerate: round > 0 });

    const bundleReview = await runStage(context, "review_bundle", reviewSchema, models.review, generate, paths, {
      system: commonSystemPrompt("小说初始化全局硬冲突审查"),
      user: appendRepairIssues(appendFactContext(`检查故事基石、世界观、核心人物势力与用户锁定事实之间是否存在阻断写入的硬冲突。只有以下情况标记 blocking：违反锁定设定（authoritativeSources 中用户明确给出的事实）、与用户创作边界或读者承诺冲突、因果矛盾或时间顺序错误。每条 blocking 必须附上冲突两处的原文引用作为 evidence。只输出 book-initialization-review.v1 JSON。\n${stringifyPrompt({ lockedBook: book, authoritativeSources: { brief: sourceFiles.brief, world: sourceFiles.world }, foundation: normalizedFoundation, world, storyGraph }, 24_000, ["authoritativeSources", "foundation", "storyGraph", "world"])}`, buildSummaryFactCards(bundle)), issues),
      maxTokens: 2_500,
      temperature: 0.1
    }, { forceRegenerate: round > 0 });

    const reviews = [entityStateReview, factFidelityReview, bundleReview];
    const blockingIssues = reviews
      .flatMap((review) => review.issues)
      .filter((issue) => issue.severity === "blocking")
      .map((issue) => issue.evidence ? `${issue.message}（证据：${issue.evidence}）` : issue.message);
    if (reviews.every((review) => review.passed) && blockingIssues.length === 0) {
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
        [...outlineFacts, ...supportingFacts, ...itemsFacts, ...stateFacts, ...buildSummaryFactCards(bundle)],
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
        review: bundleReview
      };
    }
    repairIssues = blockingIssues.length > 0
      ? blockingIssues
      : reviews.flatMap((review) => [review.summary || "未说明具体问题"]);
    if (round === maxRepairRounds) {
      context.emitProgress({ message: `一致性审查最终未通过，写入中止：${repairIssues.join("；")}` });
      throw new Error(`作品初始化一致性审查未通过：${repairIssues.join("；")}`);
    }
    context.emitProgress({ message: `一致性审查未通过（${reviews.length - reviews.filter((review) => review.passed).length}/${reviews.length} 项未通过），开始第 ${round + 1} 轮定向修复（最多 ${maxRepairRounds} 轮）。` });
  }

  throw new Error("作品初始化流程异常退出");
}

/** 审查阶段集合：这些阶段使用 review 模型与低温度。 */
const REVIEW_STAGES = new Set(["review_entity_state", "review_fact_fidelity", "review_bundle"]);
/** 事实敏感阶段集合：数字、时态、事件引用在这些阶段最容易漂移，用低温度减少改写。 */
const LOW_TEMPERATURE_STAGES = new Set(["story_backbone", "outline_plan", "initial_state", ...REVIEW_STAGES]);

/** 修复轮可以定向重生成的阶段（骨架及其下游的生成阶段）。 */
type RepairTarget = "story_backbone" | "outline" | "supporting_entities" | "items" | "initial_state";

/**
 * 把修复轮的问题清单归类到受损阶段。
 * 归类顺序按"问题最可能归属的阶段"排列：初始状态相关文本问题优先归 initial_state，
 * 再按骨架/卷纲/地点角色/物品逐级判断；无法归类的默认归 initial_state。
 * 上游阶段受损时，其下游阶段也需一并重生成（依赖传播），由调用方处理。
 */
function classifyRepairTargets(issues: string[]): Set<RepairTarget> {
  const targets = new Set<RepairTarget>();
  for (const issue of issues) {
    if (/伏笔|人物状态|势力状态|物品状态|故事起点|下一阶段|时态|数字/.test(issue)) {
      targets.add("initial_state");
    } else if (/骨架|时间线|开场事件/.test(issue)) {
      targets.add("story_backbone");
    } else if (/卷纲|总纲|分卷|主线|预计章节/.test(issue)) {
      targets.add("outline");
    } else if (/地点|次要角色|补充实体/.test(issue)) {
      targets.add("supporting_entities");
    } else if (/物品|道具/.test(issue)) {
      targets.add("items");
    } else {
      targets.add("initial_state");
    }
  }
  return targets;
}

/**
 * 开场事件清单渲染：注入 initial_state 阶段。
 * 业务原因：故事起点（storyStart）此前没有任何权威源，模型会自行扩写并发明新细节
 * （如"签到 37 天"、陌生地点），与骨架开场事件冲突。这里把 startEvents 原文注入，
 * 并约束 storyStart 只能扩写这些事件、不得引入新设定，从源头消除开场场景漂移。
 */
function renderStartEvents(backbone: StoryBackbone) {
  return backbone.startEvents.map((event) => `- [${event.id}] ${event.title}：${event.detail}`).join("\n");
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
  const purpose: InitializationModelPurpose = REVIEW_STAGES.has(stage) ? "review" : "planning";
  const outputContract = structuredOutputContract(schema);
  const request: ModelGenerateTextInput = {
    systemPrompt: `${prompt.system}\n\n${outputContract}`,
    userPrompt: prompt.user,
    // 事实敏感阶段用低温度减少数字/时态/引用漂移；发散阶段（foundation/world 等）保持默认。
    temperature: prompt.temperature ?? (LOW_TEMPERATURE_STAGES.has(stage) ? 0.1 : 0.35),
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
    user: appendRepairIssues(appendFactContext(`生成全书主线与分卷推进，不生成实体清单。预计章节数应与 plannedWords/chapterWords 基本一致；分卷数量应为支撑剧情所需的最少数量，每项内容保持简洁具体。卷纲必须延续 story_backbone：keyEvents 按其 volumeIndex 归属各卷，startEvents 中已经发生的事件不得重新安排。volume title 只写卷名本身，不得包含「第 N 卷」字样。卷纲不包含伏笔规划：全书伏笔统一由伏笔池登记，卷纲只需保证目标、冲突、转折、高潮、收束与人物变化。只输出 book-outline-plan.v1 JSON。\n${stringifyPrompt(input, 30_000, ["backbone", "foundation"])}`, factCards), repairIssues),
    maxTokens: 4_200
  }, { forceRegenerate });
  const requirements: EntityRequirements = await runStage(context, "entity_requirements", entityRequirementsSchema, model, generate, paths, {
    system: commonSystemPrompt("小说剧情实体需求规划"),
    user: appendRepairIssues(appendFactContext(`根据已完成的分卷规划，生成确有剧情用途的地点、次要角色和关键物品需求。不要生成完整设定，只列出后续阶段必须补全的最少实体；ID 使用小写英文和连字符。只输出 book-entity-requirements.v1 JSON。\n${stringifyPrompt({ world: input.world, storyGraph: input.storyGraph, outlinePlan: plan }, 30_000, ["outlinePlan", "storyGraph"])}`, factCards), repairIssues),
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
  if (schema instanceof z.ZodOptional) {
    // 可选字段：契约里不要求必填，按内部 schema 生成（required 列表已由对象层过滤 isOptional）。
    return toPromptJsonSchema(schema.unwrap());
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
 *
 * priorityKeys：超预算时按"高优先级键完整保留、低优先级键尾部截断"的方式裁剪，
 * 替代旧的整串 slice——盲切可能正好切断最易矛盾的关键字段（如骨架事件、初始状态），
 * 造成审查/生成模型"物理性失明"。高优先级键整体超过预算时退化为原始截断。
 */
function stringifyPrompt(value: unknown, limit = 30_000, priorityKeys: string[] = []) {
  const serialized = JSON.stringify(value);
  if (serialized.length <= limit) return serialized;
  if (typeof value !== "object" || value === null || Array.isArray(value) || priorityKeys.length === 0) {
    return serialized.slice(0, limit);
  }

  const highPriority = new Set(priorityKeys);
  const entries = Object.entries(value as Record<string, unknown>);
  const ordered = [
    ...entries.filter(([key]) => highPriority.has(key)),
    ...entries.filter(([key]) => !highPriority.has(key))
  ];
  let output = "{";
  for (const [key, item] of ordered) {
    const piece = `${JSON.stringify(key)}:${JSON.stringify(item)}`;
    const separator = output.length === 1 ? "" : ",";
    if (output.length + separator.length + piece.length > limit) {
      if (highPriority.has(key)) {
        return serialized.slice(0, limit);
      }
      output += `${separator}${JSON.stringify(key)}:"…（内容超预算已省略，生成时仍须遵守该字段既有事实）"}`;
      return output;
    }
    output += separator + piece;
  }
  return `${output}}`;
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
  const bookPaths = createBookPaths(paths, originalBook.id);
  const derivedStateFiles = [
    bookPaths.runtimeStateFile,
    bookPaths.storyPlanFile,
    bookPaths.worldRulesFile,
    bookPaths.authorIntentFile,
    bookPaths.currentFocusFile
  ];
  const derivedStateSnapshot = await Promise.all(derivedStateFiles.map(async (filePath) => ({
    filePath,
    content: await pathExists(filePath) ? await readTextFile(filePath) : null
  })));
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
    outline: renderOutline(bundle.outline, bundle.state.foreshadowing),
    world: preserveAuthoritativeSource(
      renderWorld(bundle.world),
      "用户权威世界观原文",
      sourceFiles.world,
      isAuthoritativeWorldSource(sourceFiles.world)
    ),
    // 当前状态与伏笔池投影统一由 runtimeStateRepository 渲染（与运行期章节更新共用同一实现）
    "current-state": renderCurrentStateMarkdown(bundle.state),
    foreshadowing: renderForeshadowingMarkdown(bundle.state, buildBundleEntityNameMap(bundle))
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
    // 三层大纲权威源：初始化写入书/卷/批次壳，章级五维按 20 章批次延迟生成。
    await writeStoryPlan(paths, originalBook.id, createInitialStoryPlan(originalBook.id, {
      mainLine: bundle.outline.mainLine,
      estimatedChapters: bundle.outline.estimatedChapters,
      volumes: bundle.outline.volumes,
      terms: [
        ...generatedEntities.map((entity) => ({ id: entity.id, term: entity.name, category: entity.entityType as "character" | "faction" | "location" | "item" })),
        ...bundle.world.rules.map((rule, index) => ({ id: `world-rule-${String(index + 1).padStart(2, "0")}`, term: rule.name, category: "rule" as const })),
        ...bundle.backbone.keyEvents.map((event) => ({ id: event.id, term: event.title, category: "event" as const }))
      ]
    }));
    signal.throwIfAborted();
    await writeWorldRuleRegistry(paths, originalBook.id, createInitialWorldRuleRegistry(originalBook.id, [
      ...bundle.world.rules.map((rule, index) => ({
        id: `world-rule-${String(index + 1).padStart(2, "0")}`,
        title: rule.name,
        content: `${rule.description}；限制：${rule.limitation}；代价：${rule.cost}`,
        category: "law" as const,
        mutability: "immutable" as const
      })),
      ...bundle.world.history.map((history, index) => ({
        id: `world-history-${String(index + 1).padStart(2, "0")}`,
        title: `历史 ${index + 1}`,
        content: history,
        category: "history" as const,
        mutability: "immutable" as const
      }))
    ]));
    signal.throwIfAborted();
    // 权威运行时状态：初始化产出作为 baseline 落盘，后续章节 delta 在其上重放合成
    await writeRuntimeState(paths, originalBook.id, createBaselineRuntimeState(bundle.state));
    signal.throwIfAborted();
    // 控制文档：长期创作意图 + 初始关注点（供续写章节意图规划与人工编辑）
    const controlFiles = stateControlFilePaths(paths, originalBook.id);
    await writeControlFile(controlFiles.authorIntent, renderAuthorIntent(bundle.foundation));
    await writeControlFile(controlFiles.currentFocus, renderInitialCurrentFocus(bundle.state));
    signal.throwIfAborted();
  } catch (error) {
    const rollback = await Promise.allSettled([
      restoreBookFilesSnapshot(paths, originalBook.id, fileSnapshot),
      saveBook(paths, originalBook),
      restoreEntityStorageSnapshot(paths, originalBook.id, entitySnapshot, generatedEntities),
      ...derivedStateSnapshot.map(async ({ filePath, content }) => {
        if (content === null) await rm(filePath, { force: true });
        else await writeTextFileAtomic(filePath, content);
      })
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
    attributes: {
      ...item,
      profile: normalizeCharacterProfile(item, {
        description: `${item.identity}；目标：${item.goal}；动机：${item.motivation}；弱点：${item.weakness}；成长：${item.arc}`,
        state: bundle.state.characterStates.find((state) => state.characterId === item.id)?.state
      })
    }
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

/**
 * 渲染长期创作意图（author_intent.md）：
 * 由初始化产出生成，作为本书"长期想成为什么"的控制文档，供续写章节意图规划持续引用。
 */
function renderAuthorIntent(foundation: Foundation) {
  return `# 创作意图（author_intent）\n\n## 作品定位\n- 名称：${foundation.book.title}\n- 题材：${foundation.book.genre}\n- 叙事人称：${foundation.book.narrationPerspective}\n- 频道：${foundation.book.channel}\n\n## 核心前提\n${foundation.premise}\n\n## 核心冲突\n${foundation.coreConflict}\n\n## 主角目标\n${foundation.protagonistGoal}\n\n## 失败代价\n${foundation.stakes}\n\n## 主题\n${markdownList(foundation.themes)}\n\n## 读者承诺\n${markdownList(foundation.readerPromises)}\n\n## 创作边界\n${markdownList(foundation.boundaries)}\n`;
}

/**
 * 渲染初始关注点（current_focus.md）：由初始状态的下一阶段目标生成，
 * 作为"最近 1-3 章要把注意力拉回哪里"的近期控制文档；章节保存后由 Observer 摘要更新。
 */
function renderInitialCurrentFocus(state: StateBundle) {
  return `# 当前关注点（current_focus）\n\n## 下一阶段目标\n${markdownList(state.nextGoals)}\n\n## 最近推进\n（尚未开始写作）\n`;
}

function renderWorld(value: World) {
  return `# 世界观\n\n## 总览\n${value.overview}\n\n## 时代\n${value.era}\n\n## 社会结构\n${value.society}\n\n## 世界规则\n${value.rules.map((rule) => `### ${rule.name}\n${rule.description}\n\n- 限制：${rule.limitation}\n- 代价：${rule.cost}`).join("\n\n")}\n\n## 力量体系\n${value.powerSystems.map((system) => `### ${system.name}\n${system.description}\n\n- 限制：${system.limitation}`).join("\n\n")}\n\n## 历史背景\n${markdownList(value.history)}\n\n## 主要区域\n${value.regions.map((region) => `- **${region.name}**（${region.id}）：${region.summary}`).join("\n")}\n\n## 冲突来源\n${markdownList(value.conflictSources)}\n`;
}

/**
 * 卷纲 Markdown 渲染。
 * 业务原因：卷纲已取消独立的伏笔计划字段，全书伏笔统一由伏笔池（foreshadowing 参数）
 * 登记；渲染时按"投放计划标注的卷号"把伏笔池条目归入对应卷的"### 伏笔"小节，
 * 实现"伏笔池中的内容在卷纲规划中展现"，保证卷纲与伏笔池单一数据源、不割裂。
 */
function renderOutline(value: Outline, foreshadowing: StateBundle["foreshadowing"]) {
  // 按投放卷号分组：无卷号标注的条目视为开篇（第 1 卷）投放
  const byVolume = new Map<number, StateBundle["foreshadowing"]>();
  for (const item of foreshadowing) {
    const volumeIndex = extractVolumeNumber(item.placement) ?? 1;
    const bucket = byVolume.get(volumeIndex) ?? [];
    bucket.push(item);
    byVolume.set(volumeIndex, bucket);
  }

  return `# 总纲与卷纲规划\n\n## 全书主线\n${value.mainLine}\n\n## 预计章节\n${value.estimatedChapters} 章\n\n${value.volumes.map((volume, index) => {
    const volumeForeshadowing = byVolume.get(index + 1) ?? [];
    return `## 第 ${index + 1} 卷：${stripVolumePrefix(volume.title)}\n\n- 目标：${volume.goal}\n- 冲突：${volume.conflict}\n- 转折：${volume.turningPoint}\n- 高潮：${volume.climax}\n- 收束：${volume.resolution}\n\n### 人物变化\n${markdownList(volume.characterChanges)}\n\n### 伏笔\n${renderVolumeForeshadowing(volumeForeshadowing)}`;
  }).join("\n\n")}\n`;
}

/** 卷纲"伏笔"小节渲染：展示伏笔池中在本卷投放的条目（ID + 内容 + 回收计划）。 */
function renderVolumeForeshadowing(items: StateBundle["foreshadowing"]) {
  if (items.length === 0) return "- 本卷无伏笔投放。";
  return items
    .map((item) => `- [${item.id}] ${escapeTable(item.content)}（回收：${escapeTable(item.resolution)}）`)
    .join("\n");
}

/** 去掉卷名里 AI 常见的“第一卷/第1卷”冗余前缀，避免渲染成“第 1 卷：第一卷 …”。 */
function stripVolumePrefix(title: string) {
  return title.trim().replace(/^第[一二三四五六七八九十百\d]+卷\s*/, "");
}

/**
 * 实体 id → 名称映射构建（Bundle 版）：供伏笔池投影把拼音 id 翻译成中文名。
 * 业务原因：实体的 relatedEntityIds 等字段按 schema 约束只能存小写英文 id（AI 生成时
 * 用拼音命名，如 su-jian），直接渲染会显示拼音让人费解；渲染层负责翻译成
 * 「名称（id）」格式，既满足人类可读，又保留 id 供写作阶段的实体工具精确引用。
 * 运行期（章节更新后）的投影使用 runtimeStateRepository.buildEntityNameMap（读实体索引）。
 */
function buildBundleEntityNameMap(bundle: InitializationBundle) {
  const names = new Map<string, string>();
  for (const character of [...bundle.storyGraph.characters, ...bundle.supporting.supportingCharacters]) {
    names.set(character.id, character.name);
  }
  for (const faction of bundle.storyGraph.factions) {
    names.set(faction.id, faction.name);
  }
  for (const location of bundle.supporting.locations) {
    names.set(location.id, location.name);
  }
  for (const item of bundle.items.items) {
    names.set(item.id, item.name);
  }
  return names;
}

function markdownList(items: string[]) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- 无";
}

function escapeTable(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function preserveAuthoritativeSource(generated: string, heading: string, source: string, preserve: boolean) {
  if (!preserve || !source.trim()) return generated;
  return `${generated.trimEnd()}\n\n# ${heading}\n\n${demoteUserSourceHeadings(source.trim())}\n`;
}

/**
 * 用户素材标题降级：用户素材可能是完整 Markdown（如历史实验生成的「故事基石」），
 * 自带顶层 H1 标题。拼接进生成文档时把 1-2 级标题各降一级（# → ##、## → ###），
 * 避免文档里出现重复 H1、标题层级混乱，同时保持用户正文逐字不变。
 * 3 级及以上标题不变，保证 MarkdownRenderer（仅支持 1-3 级）仍能正确渲染。
 */
function demoteUserSourceHeadings(source: string) {
  return source.replace(/^(#{1,2}) /gm, (_, hashes: string) => `#${hashes} `);
}

function isAuthoritativeWorldSource(source: string) {
  return !source.includes("待 AI 根据作品简介、题材和角色方向生成 world.md。")
    && !source.includes("已记录用户上传的世界观文件：");
}

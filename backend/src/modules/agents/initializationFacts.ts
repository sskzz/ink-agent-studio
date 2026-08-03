import type { BookRecord } from "../../types/domain.js";
import type { FactCard } from "../../schemas/factSchemas.js";
import type {
  EntityRequirements,
  Foundation,
  InitializationBundle,
  Outline,
  StateBundle,
  StoryBackbone,
  StoryGraph,
  SupportingEntities,
  World
} from "./bookInitializationService.js";

/**
 * 事实卡提取、注入与机器校验。
 *
 * 背景：初始化流水线各阶段单向传递产物，后期阶段看不到早期阶段的硬规则，导致
 * 生成内容相互矛盾（金手指越权、起源设定互斥、事件重复等）。这里把早期阶段产出
 * 收敛为“事实卡”，后续阶段 prompt 前统一注入【不可变事实】与【已确认设定摘要】，
 * 并用确定性校验（锁定字段矫正、事件去重）兜底，避免模型自觉保持一致。
 */

/** 不可变事实段的字符预算，超长截断并提示省略。 */
export const STABLE_FACT_SECTION_BUDGET = 3_000;
/** 已确认设定摘要段的字符预算。 */
export const SUMMARY_FACT_SECTION_BUDGET = 5_000;

const CARD_CONTENT_LIMIT = 200;
const kindLabels: Record<FactCard["kind"], string> = {
  setting: "设定",
  entity: "实体",
  event: "事件",
  timeline: "时间线",
  rule: "规则",
  promise: "承诺"
};

function pushCard(
  cards: FactCard[],
  id: string,
  kind: FactCard["kind"],
  mutability: FactCard["mutability"],
  source: FactCard["source"],
  content: string
) {
  const trimmed = content.trim();
  if (!trimmed) return;
  cards.push({
    schemaVersion: "fact-card.v1",
    id,
    kind,
    version: 1,
    status: "active",
    mutability,
    source,
    content: trimmed.length <= CARD_CONTENT_LIMIT ? trimmed : `${trimmed.slice(0, CARD_CONTENT_LIMIT - 1)}…`,
    refs: [],
    constraints: []
  });
}

export function extractFoundationFacts(book: BookRecord, foundation: Foundation): FactCard[] {
  const cards: FactCard[] = [];
  pushCard(cards, "fact:foundation-premise", "setting", "immutable", "ai-foundation", foundation.premise);
  pushCard(cards, "fact:foundation-core-conflict", "setting", "immutable", "ai-foundation", foundation.coreConflict);
  pushCard(cards, "fact:foundation-protagonist-goal", "setting", "immutable", "ai-foundation", foundation.protagonistGoal);
  pushCard(cards, "fact:foundation-stakes", "setting", "immutable", "ai-foundation", foundation.stakes);
  foundation.boundaries.forEach((boundary, index) => {
    pushCard(cards, `fact:foundation-boundary-${index + 1}`, "rule", "immutable", "ai-foundation", boundary);
  });
  foundation.readerPromises.slice(0, 5).forEach((promise, index) => {
    pushCard(cards, `fact:foundation-promise-${index + 1}`, "promise", "immutable", "ai-foundation", promise);
  });
  return cards;
}

export function extractWorldFacts(world: World): FactCard[] {
  const cards: FactCard[] = [];
  pushCard(cards, "fact:world-overview", "setting", "immutable", "ai-world", world.overview);
  pushCard(cards, "fact:world-era", "setting", "immutable", "ai-world", world.era);
  pushCard(cards, "fact:world-society", "setting", "immutable", "ai-world", world.society);
  world.rules.forEach((rule, index) => {
    pushCard(
      cards,
      `fact:world-rule-${index + 1}`,
      "rule",
      "immutable",
      "ai-world",
      `${rule.name}：${rule.description}；限制：${rule.limitation}；代价：${rule.cost}`
    );
  });
  world.powerSystems.slice(0, 4).forEach((system, index) => {
    pushCard(
      cards,
      `fact:world-power-${index + 1}`,
      "setting",
      "mutable",
      "ai-world",
      `${system.name}：${system.description}；限制：${system.limitation}`,
    );
  });
  world.regions.forEach((region) => {
    pushCard(cards, `fact:region-${region.id}`, "setting", "mutable", "ai-world", `${region.name}：${region.summary}`);
  });
  world.history.slice(0, 8).forEach((history, index) => {
    pushCard(cards, `fact:world-history-${index + 1}`, "timeline", "mutable", "ai-world", history);
  });
  world.conflictSources.slice(0, 5).forEach((conflict, index) => {
    pushCard(cards, `fact:world-conflict-${index + 1}`, "setting", "mutable", "ai-world", conflict);
  });
  return cards;
}

/**
 * 时间线骨架事实：故事开始时已发生/进行中的事件（startEvents）与贯穿全书的关键事件
 * （keyEvents）是后续卷纲、实体 firstUse、初始状态的唯一事件归口，只允许引用与扩展，
 * 不允许重编——直接从结构上杜绝"同一激活事件被安排两次"。
 */
export function extractBackboneFacts(backbone: StoryBackbone): FactCard[] {
  const cards: FactCard[] = [];
  backbone.startEvents.forEach((event, index) => {
    pushCard(
      cards,
      `fact:backbone-start-${index + 1}`,
      "timeline",
      "immutable",
      "ai-story-backbone",
      `${event.title}（开场已发生）：${event.detail}`
    );
  });
  backbone.keyEvents.forEach((event, index) => {
    pushCard(
      cards,
      `fact:backbone-key-${index + 1}`,
      "timeline",
      "mutable",
      "ai-story-backbone",
      `${event.title}（第 ${event.volumeIndex} 卷）：${event.detail}`
    );
  });
  return cards;
}

/** 上一轮一致性审查未通过的问题回注：修复轮次中注入到重生成阶段的 prompt。 */
export function appendRepairIssues(userPrompt: string, issues: string[]): string {
  if (issues.length === 0) return userPrompt;
  const lines = issues.map((issue) => `- ${issue}`).join("\n");
  return `【上一轮一致性审查未通过的问题（本轮生成必须修复，不得再次出现同类冲突）】\n${lines}\n\n${userPrompt}`;
}

/**
 * 生成【不可变事实】注入段：只取 immutable 且 active 的卡，逐字回注。
 * 这些内容必须在后续所有生成阶段保持绝对一致。
 */
export function buildStableFactSection(facts: FactCard[]): string {
  const immutable = facts.filter((card) => card.status === "active" && card.mutability === "immutable");
  if (immutable.length === 0) return "";
  const lines = immutable.map((card) => `- [${card.id}]（${kindLabels[card.kind]}）${card.content}`);
  return `【不可变事实（必须逐字遵守，不得改写、不得与生成内容冲突）】\n${capLines(lines, STABLE_FACT_SECTION_BUDGET)}\n`;
}

/**
 * 生成【已确认设定摘要】注入段：前序阶段已经确认的设定，供后续阶段直接引用，
 * 避免模型在长上下文里重复创造同一事件或设定。
 */
export function buildSummaryFactSection(facts: FactCard[]): string {
  const mutable = facts.filter((card) => card.status === "active" && card.mutability === "mutable");
  if (mutable.length === 0) return "";
  const lines = mutable.map((card) => `- [${card.id}]（${kindLabels[card.kind]}）${card.content}`);
  return `【已确认设定摘要（后续生成必须直接引用这些事实，不要重复创造或改写）】\n${capLines(lines, SUMMARY_FACT_SECTION_BUDGET)}\n`;
}

export function appendFactContext(userPrompt: string, facts: FactCard[]): string {
  const stable = buildStableFactSection(facts);
  const summary = buildSummaryFactSection(facts);
  const context = `${stable}${summary}`.trim();
  return context ? `${context}\n\n${userPrompt}` : userPrompt;
}

function capLines(lines: string[], budget: number) {
  let total = 0;
  const kept: string[] = [];
  for (const line of lines) {
    if (total + line.length + 1 > budget) break;
    kept.push(line);
    total += line.length + 1;
  }
  if (kept.length < lines.length) kept.push(`…其余 ${lines.length - kept.length} 条事实已省略，仍须遵守。`);
  return kept.join("\n");
}

/**
 * 锁定字段机器矫正：用户在创建作品时已填写的字段（needsAiFill 之外）属于不可变事实，
 * 生成结果中如出现不同值，直接以用户值覆盖，防止 AI 改写在生成阶段污染后续上下文。
 */
export function normalizeLockedBookFields(book: BookRecord, foundation: Foundation): Foundation {
  const lockedFields = [
    "title",
    "genre",
    "narrationPerspective",
    "channel",
    "protagonistGender",
    "protagonistName",
    "plannedWords",
    "chapterWords"
  ] as const;
  const next: Foundation = { ...foundation, book: { ...foundation.book } };
  const target = next.book as Record<string, unknown>;
  const source = book as unknown as Record<string, unknown>;
  for (const field of lockedFields) {
    if (book.needsAiFill.includes(field)) continue;
    const locked = source[field];
    if (locked === null || locked === undefined || locked === "") continue;
    if (target[field] !== locked) target[field] = locked;
  }
  return next;
}

/**
 * 轻量事件去重校验：卷纲伏笔 / 人物变化与初始状态伏笔不允许出现同一事件文本
 * （规范化后完全一致即判定重复），防止“同一激活事件”被重复安排在多个位置。
 */
export function verifyOutlineStateConsistency(outline: Outline, state: StateBundle): void {
  const known = new Set<string>();
  for (const volume of outline.volumes) {
    for (const item of [...volume.foreshadowing, ...volume.characterChanges]) {
      addNormalized(known, item);
    }
  }
  for (const foreshadowing of state.foreshadowing) {
    assertNotDuplicate(known, foreshadowing.content, "初始状态伏笔与卷纲规划事件重复");
  }
}

/**
 * 骨架引用校验：时间线骨架中的所有事件关联实体必须存在于核心人物/势力中。
 */
export function verifyBackboneReferences(backbone: StoryBackbone, storyGraph: StoryGraph): void {
  const entityIds = new Set([...storyGraph.characters.map((item) => item.id), ...storyGraph.factions.map((item) => item.id)]);
  for (const event of [...backbone.startEvents, ...backbone.keyEvents]) {
    for (const entityId of event.relatedEntityIds) {
      if (!entityIds.has(entityId)) throw new Error(`时间线骨架事件 ${event.title} 引用了不存在的实体：${entityId}`);
    }
  }
}

/**
 * 卷纲与骨架一致性：卷纲伏笔/人物变化不得与骨架中已经发生或安排好的事件重复。
 */
export function verifyBackboneOutlineConsistency(backbone: StoryBackbone, outline: Outline): void {
  const known = new Set<string>();
  for (const event of [...backbone.startEvents, ...backbone.keyEvents]) {
    addNormalized(known, event.title);
    addNormalized(known, event.detail);
  }
  for (const volume of outline.volumes) {
    for (const text of [...volume.foreshadowing, ...volume.characterChanges]) {
      assertNotDuplicate(known, text, "卷纲事件与时间线骨架重复");
    }
  }
}

/**
 * 初始状态与骨架一致性：初始状态伏笔/人物状态不得重复安排开场已经发生的事件。
 */
export function verifyBackboneInitialStateConsistency(backbone: StoryBackbone, state: StateBundle): void {
  const known = new Set<string>();
  for (const event of backbone.startEvents) {
    addNormalized(known, event.title);
    addNormalized(known, event.detail);
  }
  for (const foreshadowing of state.foreshadowing) {
    assertNotDuplicate(known, foreshadowing.content, "初始状态伏笔与时间线骨架开场事件重复");
  }
  for (const characterState of state.characterStates) {
    assertNotDuplicate(known, characterState.state, "初始状态人物状态与时间线骨架开场事件重复");
  }
}

/**
 * 实体需求 firstUse 与骨架一致性：实体需求中标注的首次使用事件不得与骨架开场事件重复。
 */
export function verifyRequirementsBackboneConsistency(requirements: EntityRequirements, backbone: StoryBackbone): void {
  const known = new Set<string>();
  for (const event of backbone.startEvents) {
    addNormalized(known, event.title);
    addNormalized(known, event.detail);
  }
  for (const requirement of [
    ...requirements.requiredEntities.locations,
    ...requirements.requiredEntities.supportingCharacters,
    ...requirements.requiredEntities.items
  ]) {
    assertNotDuplicate(known, requirement.firstUse, "实体需求 firstUse 与时间线骨架开场事件重复");
  }
}

/**
 * 补充地点 firstUse 与骨架一致性：补充地点的首次使用描述不得重复安排开场事件。
 */
export function verifySupportingBackboneConsistency(supporting: SupportingEntities, backbone: StoryBackbone): void {
  const known = new Set<string>();
  for (const event of backbone.startEvents) {
    addNormalized(known, event.title);
    addNormalized(known, event.detail);
  }
  for (const location of supporting.locations) {
    assertNotDuplicate(known, location.firstUse, "补充地点 firstUse 与时间线骨架开场事件重复");
  }
}

/**
 * 前情摘要归档卡：把后续阶段（续写、审稿）所需的最必要前情收敛为少量摘要卡，
 * 与全部事实卡一并持久化到 facts.json，供后续请求注入而不必重读整份文件。
 */
export function buildSummaryFactCards(bundle: InitializationBundle): FactCard[] {
  const cards: FactCard[] = [];
  pushCard(cards, "fact:summary-mainline", "setting", "mutable", "summary", bundle.outline.mainLine);
  pushCard(cards, "fact:summary-story-start", "setting", "mutable", "summary", bundle.state.storyStart);
  pushCard(cards, "fact:summary-timeline", "timeline", "mutable", "summary", bundle.backbone.timelineNote);
  return cards;
}

function addNormalized(target: Set<string>, value: string) {
  const normalized = normalizeEventText(value);
  if (normalized) target.add(normalized);
}

function assertNotDuplicate(known: Set<string>, value: string, prefix: string) {
  const normalized = normalizeEventText(value);
  if (normalized && known.has(normalized)) throw new Error(`${prefix}：${value}`);
}

function normalizeEventText(value: string) {
  return value
    .replace(/[\s，。！？、；：""''（）【】《》—…~～·]/g, "")
    .toLowerCase();
}

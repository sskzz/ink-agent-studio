import type { BookRecord } from "../../types/domain.js";
import type { FactCard } from "../../schemas/factSchemas.js";
import type {
  EntityRequirements,
  Foundation,
  InitializationBundle,
  Items,
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
 *
 * 事实卡 id 直接复用骨架事件的原始 id（如 fact:backbone-ke-3-2），保证生成阶段
 * （initial_state 伏笔文本里的 ke-* 引用）与持久化产物（facts.json）里的 id 完全一致，
 * 后续写作阶段才能解析伏笔文本中的事件引用；如果改成按序号重建 id（fact:backbone-key-N），
 * 生成期有效的引用在持久化后就会变成悬空引用。
 */
export function extractBackboneFacts(backbone: StoryBackbone): FactCard[] {
  const cards: FactCard[] = [];
  backbone.startEvents.forEach((event, index) => {
    pushCard(
      cards,
      `fact:backbone-${event.id}`,
      "timeline",
      "immutable",
      "ai-story-backbone",
      `${event.title}（开场已发生）：${event.detail}`
    );
  });
  backbone.keyEvents.forEach((event, index) => {
    pushCard(
      cards,
      `fact:backbone-${event.id}`,
      "timeline",
      "mutable",
      "ai-story-backbone",
      `${event.title}（第 ${event.volumeIndex} 卷）：${event.detail}`
    );
  });
  return cards;
}

/**
 * 补充实体事实：把地点与次要角色的身份摘要收敛为实体卡。
 * 业务原因：此前 supporting/items/state 阶段的产出从不进入事实卡，后续阶段（initial_state、
 * 写作阶段）看不到实体身份描述，导致"实体把未来事件写成既成事实（如陆瑶已住院）"这类
 * 跨阶段矛盾没有可对照的注入源——这里补齐事实传播的空洞。
 */
export function extractSupportingFacts(supporting: SupportingEntities): FactCard[] {
  const cards: FactCard[] = [];
  for (const location of supporting.locations) {
    pushCard(cards, `fact:entity-${location.id}`, "entity", "mutable", "ai-supporting-entities", `${location.name}（${location.role}）：${location.description}`);
  }
  for (const character of supporting.supportingCharacters) {
    pushCard(cards, `fact:entity-${character.id}`, "entity", "mutable", "ai-supporting-entities", `${character.name}（${character.role}角色）：${character.identity}`);
  }
  return cards;
}

/** 物品事实：把关键物品的定位与描述收敛为实体卡，供后续阶段与写作阶段引用。 */
export function extractItemFacts(items: Items): FactCard[] {
  const cards: FactCard[] = [];
  for (const item of items.items) {
    pushCard(cards, `fact:entity-${item.id}`, "entity", "mutable", "ai-items", `${item.name}（${item.role}）：${item.description}`);
  }
  return cards;
}

/**
 * 初始状态事实：把人物/势力/物品状态收敛为状态卡。
 * 业务原因：初始状态是故事开局的权威现状，写作阶段需要随时引用；此前只以 current.md
 * 文本形式存在，这里让它在 facts.json 中也有结构化卡，供连续性检查与提示词注入。
 * 注意：这些卡只用于持久化与下游写作阶段，不注入 initial_state 自身（避免自我引用）。
 */
export function extractStateFacts(state: StateBundle): FactCard[] {
  const cards: FactCard[] = [];
  for (const item of state.characterStates) {
    pushCard(cards, `fact:state-${item.characterId}`, "entity", "mutable", "ai-initial-state", `${item.characterId}：${item.state}`);
  }
  for (const item of state.factionStates) {
    pushCard(cards, `fact:state-${item.factionId}`, "entity", "mutable", "ai-initial-state", `${item.factionId}：${item.state}`);
  }
  for (const item of state.itemStates) {
    pushCard(cards, `fact:state-${item.itemId}`, "entity", "mutable", "ai-initial-state", `${item.itemId}：${item.state}`);
  }
  return cards;
}

/** 上一轮一致性审查未通过的问题回注：修复轮次中注入到重生成阶段的 prompt。 */
export function appendRepairIssues(userPrompt: string, issues: string[]): string {
  if (issues.length === 0) return userPrompt;
  const lines = issues.map((issue) => `- ${issue}`).join("\n");
  return `【上一轮校验未通过的问题（本轮生成必须逐条回应、全部修复，不得再次出现同类冲突）】\n${lines}\n\n【修复要求：问题涉及哪些字段就修改哪些字段，其余内容必须与上一版保持一致，避免整篇重写引入新的偏差】\n\n${userPrompt}`;
}

/**
 * 生成【不可变事实】注入段：只取 immutable 且 active 的卡，逐字回注。
 * 这些内容必须在后续所有生成阶段保持绝对一致。
 */
export function buildStableFactSection(facts: FactCard[]): string {
  const immutable = facts.filter((card) => card.status === "active" && card.mutability === "immutable");
  if (immutable.length === 0) return "";
  const lines = immutable.map((card) => `- [${card.id}]（${kindLabels[card.kind]}）${card.content}`);
  return `【不可变事实（必须逐字遵守：数字、人名、时态、专有名词必须与事实卡原文一致，不得改写，不得与生成内容冲突）】\n${capLines(lines, STABLE_FACT_SECTION_BUDGET)}\n`;
}

/**
 * 生成【已确认设定摘要】注入段：前序阶段已经确认的设定，供后续阶段直接引用，
 * 避免模型在长上下文里重复创造同一事件或设定。
 */
export function buildSummaryFactSection(facts: FactCard[]): string {
  const mutable = facts.filter((card) => card.status === "active" && card.mutability === "mutable");
  if (mutable.length === 0) return "";
  const lines = mutable.map((card) => `- [${card.id}]（${kindLabels[card.kind]}）${card.content}`);
  return `【已确认设定摘要（后续生成必须直接引用这些事实，不要重复创造或改写；引用其中的数字、人名、时态时必须逐字一致）】\n${capLines(lines, SUMMARY_FACT_SECTION_BUDGET)}\n`;
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
 * 卷纲与伏笔池一致性校验。
 * 业务原因：卷纲已取消独立的"伏笔计划"字段（见 volumeOutlineSchema），全书伏笔统一由
 * 伏笔池登记，卷纲渲染时按投放卷引用伏笔池内容（renderOutline 实现）。这里保留的互斥
 * 仅针对**不同类别**：伏笔池条目不得与卷纲"人物变化"文本重复（人物弧线与伏笔是两类
 * 内容，重复说明模型乱编）；骨架事件与伏笔池的去重由 verifyBackboneInitialStateConsistency 负责。
 */
export function verifyOutlineStateConsistency(outline: Outline, state: StateBundle): void {
  const knownCharacterChanges = new Set<string>();
  for (const volume of outline.volumes) {
    for (const item of volume.characterChanges) {
      addNormalized(knownCharacterChanges, item);
    }
  }
  for (const foreshadowing of state.foreshadowing) {
    assertNotDuplicate(knownCharacterChanges, foreshadowing.content, "初始状态伏笔与卷纲人物变化重复");
  }
}

/**
 * 伏笔池长线覆盖校验（确定性，宽松阈值）。
 * 业务原因：卷纲不再规划伏笔后，伏笔池是全书唯一的长线伏笔体系，必须覆盖到结局卷。
 * 这里统计全部伏笔投放/回收计划中标注的最大卷号：若最大卷号小于全书卷数，说明
 * 伏笔规划没有延伸到结局，回注修复轮推动补一条跨卷长线伏笔。
 * 语义级"各卷分布是否合理"的最终判定交给 review_fact_fidelity 聚焦审查（LLM）。
 */
export function collectForeshadowingScopeIssues(bundle: InitializationBundle): string[] {
  const issues: string[] = [];
  const totalVolumes = bundle.outline.volumes.length;
  if (totalVolumes === 0 || bundle.state.foreshadowing.length === 0) return issues;

  let maxVolume = 0;
  for (const item of bundle.state.foreshadowing) {
    const placementVolume = extractVolumeNumber(item.placement);
    const resolutionVolume = extractVolumeNumber(item.resolution);
    maxVolume = Math.max(maxVolume, placementVolume ?? 0, resolutionVolume ?? 0);
  }
  if (maxVolume < totalVolumes) {
    issues.push(`伏笔池最长只延伸到第 ${maxVolume || 1} 卷，全书共 ${totalVolumes} 卷：长线伏笔须在投放/回收计划中标注卷号并覆盖到结局卷`);
  }
  return issues;
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
 * 卷纲与骨架一致性：卷纲人物变化不得与骨架中已经发生或安排好的事件重复。
 * （卷纲已取消独立的伏笔计划字段，伏笔统一由伏笔池登记，故这里只校验人物变化。）
 */
export function verifyBackboneOutlineConsistency(backbone: StoryBackbone, outline: Outline): void {
  const known = new Set<string>();
  for (const event of [...backbone.startEvents, ...backbone.keyEvents]) {
    addNormalized(known, event.title);
    addNormalized(known, event.detail);
  }
  for (const volume of outline.volumes) {
    for (const text of volume.characterChanges) {
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

/**
 * 构建可引用实体 ID 清单（注入生成阶段 prompt）。
 * 业务原因：模型在长上下文中会“发明”看似合理的实体 ID（如物品状态引用了不存在的物品），
 * 把当前全部可用 ID 与名称显式列出并强制“只能引用以下 ID”，从源头消除悬空引用。
 */
export function buildEntityIdRegistry(bundle: Pick<InitializationBundle, "storyGraph" | "supporting" | "items">): string {
  const lines: string[] = [];
  for (const character of bundle.storyGraph.characters) {
    lines.push(`- [${character.id}] ${character.name}（角色）`);
  }
  for (const faction of bundle.storyGraph.factions) {
    lines.push(`- [${faction.id}] ${faction.name}（势力）`);
  }
  for (const location of bundle.supporting.locations) {
    lines.push(`- [${location.id}] ${location.name}（地点）`);
  }
  for (const character of bundle.supporting.supportingCharacters) {
    lines.push(`- [${character.id}] ${character.name}（角色）`);
  }
  for (const item of bundle.items.items) {
    lines.push(`- [${item.id}] ${item.name}（物品）`);
  }
  return lines.join("\n");
}

/**
 * 收集全量引用完整性错误（不抛错）。
 * 业务原因：引用悬空属于模型生成偏差，可通过“把错误回注给对应阶段重生成”修复；
 * 收集全部问题（而非首个即失败）让修复轮一次拿全反馈，避免逐条修补浪费轮次。
 */
export function collectInitializationReferenceIssues(bundle: InitializationBundle): string[] {
  const issues: string[] = [];
  const entityIds = new Set([
    ...bundle.storyGraph.characters.map((item) => item.id),
    ...bundle.storyGraph.factions.map((item) => item.id),
    ...bundle.supporting.locations.map((item) => item.id),
    ...bundle.supporting.supportingCharacters.map((item) => item.id),
    ...bundle.items.items.map((item) => item.id)
  ]);
  const regionIds = new Set(bundle.world.regions.map((item) => item.id));

  for (const character of bundle.storyGraph.characters) {
    for (const factionId of character.factionIds) {
      if (!entityIds.has(factionId)) issues.push(`人物 ${character.name} 引用了不存在的势力：${factionId}`);
    }
  }
  for (const relation of bundle.storyGraph.relationships) {
    if (!entityIds.has(relation.fromId)) issues.push(`关系起点不存在：${relation.fromId}`);
    if (!entityIds.has(relation.toId)) issues.push(`关系终点不存在：${relation.toId}`);
  }
  for (const location of bundle.supporting.locations) {
    if (!regionIds.has(location.regionId)) issues.push(`地点 ${location.name} 引用了不存在的区域：${location.regionId}`);
    if (location.controllerFactionId && !entityIds.has(location.controllerFactionId)) {
      issues.push(`地点 ${location.name} 引用了不存在的势力：${location.controllerFactionId}`);
    }
  }
  for (const character of bundle.supporting.supportingCharacters) {
    for (const factionId of character.factionIds) {
      if (!entityIds.has(factionId)) issues.push(`人物 ${character.name} 引用了不存在的势力：${factionId}`);
    }
  }
  for (const item of bundle.items.items) {
    if (item.ownerEntityId && !entityIds.has(item.ownerEntityId)) {
      issues.push(`物品 ${item.name} 的所有者不存在：${item.ownerEntityId}`);
    }
    if (item.locationId && !entityIds.has(item.locationId)) {
      issues.push(`物品 ${item.name} 的地点不存在：${item.locationId}`);
    }
  }
  for (const state of bundle.state.characterStates) {
    if (!entityIds.has(state.characterId)) issues.push(`人物状态引用不存在：${state.characterId}`);
  }
  for (const state of bundle.state.factionStates) {
    if (!entityIds.has(state.factionId)) issues.push(`势力状态引用不存在：${state.factionId}`);
  }
  for (const state of bundle.state.itemStates) {
    if (!entityIds.has(state.itemId)) issues.push(`物品状态引用不存在：${state.itemId}`);
  }
  for (const foreshadowing of bundle.state.foreshadowing) {
    for (const entityId of foreshadowing.relatedEntityIds) {
      if (!entityIds.has(entityId)) issues.push(`伏笔引用不存在：${entityId}`);
    }
  }
  return issues;
}

/**
 * 实体 ID 唯一性校验：重复 ID 属于结构性错误，无法靠"重新引用"修复，直接抛错。
 */
export function assertUniqueEntityIds(bundle: InitializationBundle): void {
  const ids = [
    ...bundle.storyGraph.characters.map((item) => item.id),
    ...bundle.storyGraph.factions.map((item) => item.id),
    ...bundle.supporting.locations.map((item) => item.id),
    ...bundle.supporting.supportingCharacters.map((item) => item.id),
    ...bundle.items.items.map((item) => item.id)
  ];
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    const duplicates = [...unique].filter((id) => ids.filter((item) => item === id).length > 1);
    throw new Error(`实体 ID 重复：${duplicates.join("、")}`);
  }
}

/** 骨架事件 id 的规范形态：startEvents 用 st-X，keyEvents 用 ke-卷-序号（提示词约定）。 */
const EVENT_ID_TOKEN = /\b(?:ke|st)-\d+(?:-\d+)?\b/gi;

/**
 * 事件引用完整性校验（确定性）。
 * 业务原因：initial_state 的伏笔文本会引用骨架事件（如 ke-3-2），此前只校验实体 id，
 * 事件引用既不校验、生成期 id 又不随 facts.json 持久化，最终产物里出现悬空引用。
 * 这里抽取文本中的 ke-/st- 令牌与骨架事件 id 交叉验证，并检查"投放卷号不晚于回收卷号"，
 * 错误一律回注修复轮，让模型定向修复引用文本。
 */
export function collectEventReferenceIssues(bundle: InitializationBundle): string[] {
  const issues: string[] = [];
  const eventIds = new Set([
    ...bundle.backbone.startEvents.map((event) => event.id),
    ...bundle.backbone.keyEvents.map((event) => event.id)
  ]);

  // 伏笔文本与故事起点中出现的 ke-/st- 令牌必须能在骨架中找到对应事件
  const sources: Array<[string, string]> = [
    ["故事起点", bundle.state.storyStart],
    ...bundle.state.foreshadowing.flatMap((foreshadowing): Array<[string, string]> => [
      [`伏笔「${foreshadowing.id}」的投放计划`, foreshadowing.placement],
      [`伏笔「${foreshadowing.id}」的回收计划`, foreshadowing.resolution]
    ])
  ];
  for (const [label, text] of sources) {
    for (const token of text.matchAll(EVENT_ID_TOKEN)) {
      if (!eventIds.has(token[0])) {
        issues.push(`${label}引用了不存在的骨架事件：${token[0]}`);
      }
    }
  }

  // 投放卷号必须不晚于回收卷号：伏笔"投放早于回收"的时间顺序
  for (const foreshadowing of bundle.state.foreshadowing) {
    const placementVolume = extractVolumeNumber(foreshadowing.placement);
    const resolutionVolume = extractVolumeNumber(foreshadowing.resolution);
    if (placementVolume !== null && resolutionVolume !== null && placementVolume > resolutionVolume) {
      issues.push(`伏笔「${foreshadowing.id}」的投放（第 ${placementVolume} 卷）晚于回收（第 ${resolutionVolume} 卷），时间顺序不成立`);
    }
  }

  return issues;
}

/** 从文本中提取"第 N 卷"的卷号；数字用阿拉伯数字，汉字一到十按位转换，无法解析返回 null。 */
export function extractVolumeNumber(text: string): number | null {
  const match = /第([一二三四五六七八九十\d]+)卷/.exec(text);
  if (!match) return null;
  const chineseIndex = "一二三四五六七八九十".indexOf(match[1]);
  if (chineseIndex >= 0) return chineseIndex + 1;
  const number = Number(match[1]);
  return Number.isFinite(number) ? number : null;
}

/** 数字/时态锚词归一化：不同写法归一到同一个事实键，便于跨来源比对。 */
const NUMBER_ANCHOR_PATTERNS: Array<{ key: string; pattern: RegExp }> = [
  { key: "连签天数", pattern: /连续打卡|连续签到|连签|打卡/ },
  { key: "好感度", pattern: /好感度/ }
];

/** 完成时态标记词：表示"已经发生/已经达成"。 */
const PAST_TENSE_WORDS = /已|已经|坚持/;
/** 未来时态标记词：表示"尚未发生/即将达成"。 */
const FUTURE_TENSE_WORDS = /即将|快要|马上|准备|预计|计划/;

/**
 * 数字/时态忠实度校验（确定性，启发式）。
 * 业务原因：同一事实（如林晚晴连签天数）在骨架与初始状态中可能被模型改写成不同数字
 * 或不同时态（"已连续打卡 200 天" vs "即将达到 200 天"），此前没有任何校验兜底。
 * 这里以"人物名 + 锚词"为键，收集其在不同来源文本中的数值与时态，出现数值冲突或
 * 时态互斥（已发生 vs 即将发生）即回注修复轮。
 *
 * 误报控制：只扫描"已知人物名后 40 字符内出现数字+天/%单位"的片段，且锚词必须在片段内；
 * 无主语的泛指数字（如街边陌生女生的"打卡第 37 天"）不会命中。
 */
export function collectNumberDriftIssues(bundle: InitializationBundle): string[] {
  const issues: string[] = [];
  const names = [
    ...bundle.storyGraph.characters.map((character) => character.name),
    ...bundle.supporting.supportingCharacters.map((character) => character.name)
  ];

  // 每个 (人物名, 锚词键) 收集：数字集合 + 时态集合 + 命中的原文片段
  const factsByKey = new Map<string, { numbers: Set<string>; tenses: Set<string>; samples: string[] }>();

  const scanText = (text: string) => {
    if (!text) return;
    for (const name of names) {
      // 人物名后 0-40 字符内出现数字（可选单位），保证片段确实与人物相关
      const pattern = new RegExp(`${escapeRegExp(name)}[^。；\\n]{0,40}?(\\d+)\\s*(天|%)?`, "g");
      for (const match of text.matchAll(pattern)) {
        const segment = match[0];
        const anchor = NUMBER_ANCHOR_PATTERNS.find((item) => item.pattern.test(segment));
        if (!anchor) continue;
        const key = `${name}:${anchor.key}`;
        const entry = factsByKey.get(key) ?? { numbers: new Set(), tenses: new Set(), samples: [] };
        entry.numbers.add(match[1]);
        if (PAST_TENSE_WORDS.test(segment)) entry.tenses.add("已发生");
        if (FUTURE_TENSE_WORDS.test(segment)) entry.tenses.add("即将发生");
        if (entry.samples.length < 3) entry.samples.push(segment.trim());
        factsByKey.set(key, entry);
      }
    }
  };

  // 扫描所有事实来源：骨架事件、卷纲、初始状态
  for (const event of [...bundle.backbone.startEvents, ...bundle.backbone.keyEvents]) {
    scanText(event.title);
    scanText(event.detail);
  }
  for (const volume of bundle.outline.volumes) {
    scanText(volume.goal);
    scanText(volume.conflict);
    scanText(volume.turningPoint);
    scanText(volume.climax);
    scanText(volume.resolution);
    volume.characterChanges.forEach(scanText);
  }
  scanText(bundle.outline.mainLine);
  scanText(bundle.state.storyStart);
  bundle.state.nextGoals.forEach(scanText);
  bundle.state.characterStates.forEach((item) => scanText(item.state));
  bundle.state.factionStates.forEach((item) => scanText(item.state));
  bundle.state.itemStates.forEach((item) => scanText(item.state));
  bundle.state.foreshadowing.forEach((item) => {
    scanText(item.content);
    scanText(item.placement);
    scanText(item.resolution);
  });

  for (const [key, entry] of factsByKey) {
    const [name, anchorKey] = key.split(":");
    // 同一事实出现多个不同数值 → 数字漂移
    if (entry.numbers.size > 1) {
      issues.push(`人物「${name}」的${anchorKey}在不同来源中出现矛盾数值：${[...entry.numbers].join(" / ")}（片段：${entry.samples.join("；")}）`);
    }
    // 同一事实既标"已发生"又标"即将发生" → 时态互斥
    if (entry.tenses.has("已发生") && entry.tenses.has("即将发生")) {
      issues.push(`人物「${name}」的${anchorKey}时态矛盾：一处表述为已发生，另一处表述为即将发生（片段：${entry.samples.join("；")}）`);
    }
  }

  return issues;
}

/** 正则转义：人物名作为正则字面量拼接时，先转义其中的特殊字符。 */
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

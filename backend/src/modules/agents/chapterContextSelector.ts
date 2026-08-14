/**
 * 章节上下文检索器：为续写装配"定向注入"的 facts 层来源（替代四份文件全量注入）。
 *
 * 借鉴 InkOS Composer 的"按任务选择上下文"思路：每章写作只注入与本章相关的内容——
 * 1. 基线（不可省）：作品属性 + 事实卡中的故事基石摘要（前提/核心冲突/目标/失败代价）；
 * 2. 实体定向：章节细纲 + 正文尾部中出现的实体（名称/id 匹配）→ 注入完整描述；
 * 3. 状态定向：命中实体的当前人物/物品状态条目；
 * 4. 伏笔定向：relatedEntityIds 与命中实体相交的伏笔条目（含投放/回收计划）；
 * 5. 世界观基线：world.md 开篇总览与规则（预算内截断）。
 *
 * 全量模式（retrievalMode=full）由调用方保留原四文件注入，两模式可经配置切换对比质量。
 */
import type { PromptSource } from "../prompts/promptAssembler.js";
import type { BookEntityRecord } from "../../types/domain.js";
import type { RuntimeState } from "../../schemas/runtimeStateSchemas.js";
import type { StoryPlan, WorldRuleRegistry } from "../../schemas/storyKnowledgeSchemas.js";
import { renderBookCoreMetadata, renderBookFoundation, type BookGenerationMetadata } from "./bookGenerationMetadata.js";
import { readCharacterProfile } from "../books/storyKnowledgeRepository.js";
import { scheduleForeshadowing } from "../books/foreshadowingScheduler.js";

/** 定向检索的输入：作品元数据、章节信息、实体索引、权威状态与事实卡。 */
export interface ChapterContextInput {
  bookMetadata: BookGenerationMetadata;
  chapterTitle: string;
  chapterNo?: number;
  chapterOutline: string;
  currentContent: string;
  worldContent: string;
  entities: BookEntityRecord[];
  runtimeState: RuntimeState | null;
  storyPlan?: StoryPlan | null;
  worldRules?: WorldRuleRegistry | null;
}

/** 定向检索输出：facts 层来源列表 + 统计信息（供 trace 审计）。 */
export interface ChapterContextSelection {
  sources: PromptSource[];
  matchedEntityIds: string[];
  matchedForeshadowingIds: string[];
  matchedWorldRuleIds: string[];
}

/** 从事实卡中提取故事基石摘要来源（前提/核心冲突/目标/失败代价，不可变卡优先）。 */
function buildFoundationSources(input: ChapterContextInput): PromptSource[] {
  const foundation = renderBookFoundation(input.bookMetadata);
  const sources: PromptSource[] = [
    {
      id: "book-metadata",
      label: "作品属性",
      content: renderBookCoreMetadata(input.bookMetadata),
      priority: 100,
      maxTokens: 600,
      sourceRef: { type: "book" }
    }
  ];
  if (foundation) {
    sources.push({
      id: "foundation-brief",
      label: "故事基石摘要",
      content: foundation,
      priority: 85,
      maxTokens: 1_200,
      sourceRef: { fileId: "brief", derived: true }
    });
  }
  return sources;
}

/**
 * 检索与本章相关的实体、状态与伏笔。
 * 匹配策略：章节细纲与正文尾部 1500 字符内出现实体名称（含 id）即视为相关；
 * 名称匹配覆盖拼音 id 与中文名两种写法。
 * 基线来源（不依赖匹配）：作品属性 + 故事基石摘要 + 世界观开篇总览与规则（预算内截断）。
 */
export function selectChapterContext(input: ChapterContextInput): ChapterContextSelection {
  const sources = buildFoundationSources(input);
  const matchedForeshadowingIds = new Set<string>();
  const matchedWorldRuleIds = new Set<string>();

  // 世界观基线：只取总览与早期规则段（maxTokens 交给 PromptAssembler 预算内截断）
  sources.push({
    id: "world-baseline",
    label: "世界观基线",
    content: input.worldContent.slice(0, 4_000),
    priority: 70,
    maxTokens: 1_200,
    sourceRef: { fileId: "world", derived: true }
  });

  // 命中判定文本：细纲 + 正文尾部（保留最近内容，正文越长尾部越相关）
  const probeText = `${input.chapterOutline || ""}\n${input.chapterTitle}\n${input.currentContent.slice(-1_500)}`;
  const chapterNo = input.chapterNo ?? 1;
  const matchedEntityIds = new Set<string>();

  // 三层大纲只注入“当前卷 + 当前章五维 + 相邻章承接”，而不是把最多 1000 章全量塞入 Prompt。
  const storyPlanChapter = input.storyPlan?.chapters.find((chapter) => chapter.chapterNo === chapterNo);
  const storyPlanVolume = input.storyPlan?.volumes.find((volume) =>
    chapterNo >= volume.chapterRange.start && chapterNo <= volume.chapterRange.end
  );
  if (storyPlanVolume) {
    sources.push({
      id: `volume-plan-${storyPlanVolume.volumeNo}`,
      label: "当前卷约束",
      content: `卷名：${storyPlanVolume.title}\n目标：${storyPlanVolume.objective}\n冲突：${storyPlanVolume.conflict}\n转折：${storyPlanVolume.turningPoint}\n高潮：${storyPlanVolume.climax}\n收束：${storyPlanVolume.resolution}`,
      priority: 92,
      maxTokens: 800,
      sourceRef: { type: "story-plan", level: "volume", volumeNo: storyPlanVolume.volumeNo }
    });
  }
  if (storyPlanChapter) {
    const dimensions = storyPlanChapter.dimensions;
    sources.push({
      id: `chapter-plan-${chapterNo}`,
      label: "章级五维硬约束",
      content: [
        `梗概：${dimensions.synopsis}`,
        `角色行为：${dimensions.characterActions.map((item) => `${item.characterId}=${item.action}${item.expectedState ? ` → ${item.expectedState}` : ""}`).join("；")}`,
        `场景：${dimensions.scenes.join("；")}`,
        `冲突：${dimensions.conflicts.join("；")}`,
        `叙事目标：${dimensions.narrativeGoals.join("；")}`
      ].join("\n"),
      priority: 100,
      maxTokens: 1_500,
      minTokens: 500,
      sourceRef: { type: "story-plan", level: "chapter", chapterNo }
    });
    for (const action of dimensions.characterActions) matchedEntityIds.add(action.characterId);
  }
  if (input.storyPlan) {
    const neighbors = input.storyPlan.chapters
      .filter((chapter) => chapter.chapterNo === chapterNo - 1 || chapter.chapterNo === chapterNo + 1)
      .sort((left, right) => left.chapterNo - right.chapterNo);
    if (neighbors.length > 0) {
      sources.push({
        id: "neighbor-chapter-plans",
        label: "相邻章承接",
        content: neighbors.map((chapter) => `第 ${chapter.chapterNo} 章：${chapter.dimensions.synopsis}\n叙事目标：${chapter.dimensions.narrativeGoals.join("；")}`).join("\n\n"),
        priority: 88,
        maxTokens: 650,
        sourceRef: { type: "story-plan", level: "neighbor", chapterNo }
      });
    }
  }

  // 实体定向：名称/id 命中
  for (const entity of input.entities) {
    if (entity.name && probeText.includes(entity.name)) matchedEntityIds.add(entity.id);
    else if (entity.id && probeText.includes(entity.id)) matchedEntityIds.add(entity.id);
  }

  // 状态定向：命中实体的当前状态条目
  const runtimeState = input.runtimeState;
  if (runtimeState && matchedEntityIds.size > 0) {
    const relatedCharacterStates = runtimeState.state.characterStates.filter((item) => matchedEntityIds.has(item.characterId));
    const relatedItemStates = runtimeState.state.itemStates.filter((item) => matchedEntityIds.has(item.itemId));
    const stateLines = [
      ...relatedCharacterStates.map((item) => `${item.characterId}：${item.state}`),
      ...relatedItemStates.map((item) => `${item.itemId}：${item.state}`)
    ];
    if (stateLines.length > 0) {
      sources.push({
        id: "related-state",
        label: "相关状态",
        content: stateLines.join("\n"),
        priority: 95,
        maxTokens: 1_000,
        sourceRef: { fileId: "current-state", derived: true }
      });
    }

    // 伏笔调度：实体相关 + 本章到期/逾期条目。逾期两次的伏笔以最高优先级强制注入。
    const relatedForeshadowing = scheduleForeshadowing(runtimeState.state.foreshadowing, chapterNo).filter((item) =>
      item.relatedEntityIds.some((id) => matchedEntityIds.has(id)) || item.scheduleStatus !== "on_track"
    );
    for (const item of relatedForeshadowing) {
      matchedForeshadowingIds.add(item.id);
      sources.push({
        id: `foreshadowing-${item.id}`,
        label: item.forceRecovery ? `强制回收伏笔：${item.id}` : `伏笔：${item.id}`,
        content: `${item.forceRecovery ? "本章必须安排推进或回收，不得再次跳过。\n" : ""}${item.content}\n类型：${item.horizon}\n投放：${item.placement}\n回收：${item.resolution}\n生命周期：${item.status}\n调度：${item.scheduleStatus}，missedCount=${item.missedCount}`,
        priority: item.forceRecovery ? 100 : item.scheduleStatus === "overdue" ? 97 : item.scheduleStatus === "due" ? 94 : 80,
        maxTokens: 450,
        minTokens: item.forceRecovery ? 200 : 0,
        sourceRef: { fileId: "foreshadowing", derived: true }
      });
    }

  }

  // 实体设定来自独立权威索引，不应因 runtime.json 暂时缺失而一起丢失。
  const matchedEntities = input.entities.filter((entity) => matchedEntityIds.has(entity.id));
  for (const entity of matchedEntities) {
    const profile = readCharacterProfile(entity);
    const profileText = profile ? [
      `性格：${profile.core.personalityTraits.join("；") || "未补充"}`,
      `动机：${profile.core.motivations.join("；") || "未补充"}`,
      `硬约束：${profile.core.hardConstraints.join("；") || "无"}`,
      `禁止行为：${profile.core.prohibitedActions.join("；") || "无"}`,
      `成长方向：${profile.arc.startState} → ${profile.arc.targetState}`,
      `时间线状态：${profile.timeline.currentState || "未补充"}`,
      `关系：${profile.relationships.map((item) => `${item.targetCharacterId}=${item.relation}/${item.tension}`).join("；") || "未补充"}`,
      `对话 DNA：${profile.dialogueDna.voice || "未补充"}；句式=${profile.dialogueDna.sentenceRhythm || "未补充"}；禁用表达=${profile.dialogueDna.forbiddenExpressions.join("、") || "无"}`
    ].join("\n") : "";
    sources.push({
      id: `entity-${entity.id}`,
      label: `设定：${entity.name}`,
      content: `${entity.name}（${entity.role || "未分类"}）：${entity.description || entity.role || "暂无描述"}${profileText ? `\n${profileText}` : ""}`,
      priority: profile ? 96 : 90,
      maxTokens: profile ? 1_200 : 800,
      sourceRef: { type: "entity", entityId: entity.id, derived: true }
    });
  }

  // 世界规则以结构化规则库为准。只注入不可变规则和被本章文本命中的可变规则，避免全库注入。
  const worldRules = (input.worldRules?.rules ?? []).filter((rule) => rule.status === "active");
  const selectedWorldRules = worldRules.filter((rule) =>
    rule.mutability === "immutable" || probeText.includes(rule.title) || probeText.includes(rule.id)
  ).slice(0, 10);
  if (selectedWorldRules.length > 0) {
    selectedWorldRules.forEach((rule) => matchedWorldRuleIds.add(rule.id));
    sources.push({
      id: "effective-world-rules",
      label: "命中世界规则",
      content: selectedWorldRules.map((rule) => `[${rule.id}] ${rule.title}：${rule.content}${rule.mutability === "immutable" ? "（不可改写）" : ""}`).join("\n"),
      priority: 98,
      maxTokens: 1_500,
      minTokens: Math.min(400, selectedWorldRules.length * 80),
      sourceRef: { type: "world-rule-registry", ruleIds: [...matchedWorldRuleIds] }
    });
  }

  return {
    sources,
    matchedEntityIds: [...matchedEntityIds],
    matchedForeshadowingIds: [...matchedForeshadowingIds],
    matchedWorldRuleIds: [...matchedWorldRuleIds]
  };
}

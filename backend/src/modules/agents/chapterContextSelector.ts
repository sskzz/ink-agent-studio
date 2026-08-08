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
import { renderBookCoreMetadata, renderBookFoundation, type BookGenerationMetadata } from "./bookGenerationMetadata.js";

/** 定向检索的输入：作品元数据、章节信息、实体索引、权威状态与事实卡。 */
export interface ChapterContextInput {
  bookMetadata: BookGenerationMetadata;
  chapterTitle: string;
  chapterOutline: string;
  currentContent: string;
  worldContent: string;
  entities: BookEntityRecord[];
  runtimeState: RuntimeState | null;
}

/** 定向检索输出：facts 层来源列表 + 统计信息（供 trace 审计）。 */
export interface ChapterContextSelection {
  sources: PromptSource[];
  matchedEntityIds: string[];
  matchedForeshadowingIds: string[];
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

  // 实体定向：名称/id 命中
  const matchedEntityIds = new Set<string>();
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

    // 伏笔定向：relatedEntityIds 与命中实体相交的伏笔
    const relatedForeshadowing = runtimeState.state.foreshadowing.filter((item) =>
      item.relatedEntityIds.some((id) => matchedEntityIds.has(id))
    );
    for (const item of relatedForeshadowing) {
      matchedForeshadowingIds.add(item.id);
      sources.push({
        id: `foreshadowing-${item.id}`,
        label: `伏笔：${item.id}`,
        content: `${item.content}\n投放：${item.placement}\n回收：${item.resolution}\n状态：${item.status}`,
        priority: 80,
        maxTokens: 400,
        sourceRef: { fileId: "foreshadowing", derived: true }
      });
    }

  }

  // 实体设定来自独立权威索引，不应因 runtime.json 暂时缺失而一起丢失。
  const matchedEntities = input.entities.filter((entity) => matchedEntityIds.has(entity.id));
  for (const entity of matchedEntities) {
    sources.push({
      id: `entity-${entity.id}`,
      label: `设定：${entity.name}`,
      content: `${entity.name}（${entity.role || "未分类"}）：${entity.description || entity.role || "暂无描述"}`,
      priority: 90,
      maxTokens: 800,
      sourceRef: { type: "entity", entityId: entity.id, derived: true }
    });
  }

  return {
    sources,
    matchedEntityIds: [...matchedEntityIds],
    matchedForeshadowingIds: [...matchedForeshadowingIds]
  };
}

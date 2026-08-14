/**
 * 章节上下文检索器单测：基线来源、实体/状态/伏笔定向匹配。
 */
import { describe, expect, it } from "vitest";
import type { BookEntityRecord } from "../../types/domain.js";
import type { RuntimeState } from "../../schemas/runtimeStateSchemas.js";
import { selectChapterContext } from "./chapterContextSelector.js";
import type { BookGenerationMetadata } from "./bookGenerationMetadata.js";
import { createInitialStoryPlan, createInitialWorldRuleRegistry } from "../books/storyKnowledgeRepository.js";

/** 构造检索输入夹具：包含苏见/陈栀两个实体与对应状态/伏笔。 */
function createInputFixture(overrides: Partial<Parameters<typeof selectChapterContext>[0]> = {}) {
  const entities: BookEntityRecord[] = [
    {
      id: "su-jian",
      bookId: "book-1",
      entityType: "character",
      name: "苏见",
      role: "主要",
      description: "无系统的观测者",
      fileId: "entity-su-jian",
      attributes: {},
      createdAt: "",
      updatedAt: ""
    },
    {
      id: "chen-zhi",
      bookId: "book-1",
      entityType: "character",
      name: "陈栀",
      role: "次要",
      description: "学霸系统持有者",
      fileId: "entity-chen-zhi",
      attributes: {},
      createdAt: "",
      updatedAt: ""
    }
  ];
  const bookMetadata: BookGenerationMetadata = {
    schemaVersion: "book-generation-metadata.v1",
    bookId: "book-1",
    title: "测试书",
    genre: "轻小说",
    channel: "男频",
    narrationPerspective: "第三人称",
    protagonist: { name: "苏见", gender: "男" },
    plannedWords: 500000,
    chapterWords: 2000,
    writingStyle: { id: "style-1", versionId: "version-1" },
    foundation: {
      premise: "男主能看见女孩头顶的系统面板",
      coreConflict: "只读不可改，只能间接引导",
      protagonistGoal: "保护同伴",
      stakes: "错误引导会伤害他人",
      boundaries: ["能力不能代替人物选择"],
      readerPromises: []
    },
    unresolvedFields: []
  };
  const runtimeState: RuntimeState = {
    schemaVersion: "book-runtime-state.v1",
    baseline: {
      storyStart: "起点",
      publicFacts: [],
      secrets: [],
      nextGoals: ["接近陈栀"],
      characterStates: [{ characterId: "su-jian", state: "刚觉醒能力" }, { characterId: "chen-zhi", state: "备考高压中" }],
      factionStates: [],
      itemStates: [],
      foreshadowing: [
        { id: "hook-chen", content: "陈栀的隐藏注记", relatedEntityIds: ["chen-zhi"], placement: "第一卷", resolution: "第二卷", status: "planned", lastAdvancedChapter: null },
        { id: "hook-other", content: "无关伏笔", relatedEntityIds: [], placement: "第五卷", resolution: "终卷", status: "planned", lastAdvancedChapter: null }
      ]
    },
    deltas: [],
    history: [],
    state: {
      storyStart: "起点",
      publicFacts: [],
      secrets: [],
      nextGoals: ["接近陈栀"],
      characterStates: [{ characterId: "su-jian", state: "刚觉醒能力" }, { characterId: "chen-zhi", state: "备考高压中" }],
      factionStates: [],
      itemStates: [],
      foreshadowing: [
        { id: "hook-chen", content: "陈栀的隐藏注记", relatedEntityIds: ["chen-zhi"], placement: "第一卷", resolution: "第二卷", status: "planned", lastAdvancedChapter: null },
        { id: "hook-other", content: "无关伏笔", relatedEntityIds: [], placement: "第五卷", resolution: "终卷", status: "planned", lastAdvancedChapter: null }
      ]
    },
    chapterSummaries: {}
  };
  return {
    bookMetadata,
    chapterTitle: "第一章",
    chapterOutline: "苏见观察到陈栀的异常",
    currentContent: "",
    worldContent: "# 世界观\n\n总览：潮汐市。",
    entities,
    runtimeState,
    ...overrides
  };
}

describe("selectChapterContext", () => {
  it("总是包含作品属性、故事基石摘要与世界观基线来源", () => {
    const selection = selectChapterContext(createInputFixture());
    const ids = selection.sources.map((source) => source.id);

    expect(ids).toContain("book-metadata");
    expect(ids).toContain("foundation-brief");
    expect(ids).toContain("world-baseline");
    expect(selection.sources.find((source) => source.id === "book-metadata")?.content).toContain("主角：苏见");
    expect(selection.sources.find((source) => source.id === "book-metadata")?.content).toContain("频道：男频");
  });

  it("按细纲中的实体名定向注入实体描述、相关状态与相关伏笔", () => {
    const selection = selectChapterContext(createInputFixture());
    const ids = selection.sources.map((source) => source.id);

    // 细纲含"陈栀"→ 注入陈栀实体与相关状态；无关实体苏见不注入实体描述（细纲未出现）
    expect(ids).toContain("entity-chen-zhi");
    expect(ids).toContain("foreshadowing-hook-chen");
    expect(ids).not.toContain("foreshadowing-hook-other");
    expect(selection.matchedEntityIds).toContain("chen-zhi");
    expect(selection.matchedForeshadowingIds).toEqual(["hook-chen"]);
  });

  it("正文尾部命中实体时同样定向注入", () => {
    const selection = selectChapterContext(createInputFixture({ currentContent: "苏见站在走廊上。" }));
    const ids = selection.sources.map((source) => source.id);

    expect(ids).toContain("entity-su-jian");
    expect(selection.matchedEntityIds).toContain("su-jian");
  });

  it("运行时状态缺失时仍返回基线来源（降级）", () => {
    const selection = selectChapterContext(createInputFixture({ runtimeState: null }));
    const ids = selection.sources.map((source) => source.id);

    expect(ids).toContain("book-metadata");
    expect(ids).toContain("world-baseline");
    // 实体索引独立可用；只有运行时状态与伏笔随 runtime.json 缺失而降级
    expect(ids).toContain("entity-chen-zhi");
    expect(ids).not.toContain("foreshadowing-hook-chen");
    expect(selection.matchedEntityIds.length).toBeGreaterThan(0);
  });

  it("只注入当前卷、当前章五维、命中角色档案和有效世界规则，不全量注入千章规划", () => {
    const plan = createInitialStoryPlan("book-1", {
      mainLine: "测试主线", estimatedChapters: 50,
      volumes: [{ title: "第一卷", goal: "卷目标", conflict: "卷冲突", turningPoint: "卷转折", climax: "卷高潮", resolution: "卷收束", characterChanges: [] }],
      terms: []
    });
    plan.chapters.push({
      chapterNo: 1, volumeNo: 1, title: "第一章", status: "approved", reviewNotes: [], lockedTermIds: [],
      dimensions: { synopsis: "苏见追查异常", characterActions: [{ characterId: "su-jian", action: "观察异常" }], scenes: ["教室"], conflicts: ["不敢暴露能力"], narrativeGoals: ["建立谜团"] }
    });
    const rules = createInitialWorldRuleRegistry("book-1", [{ id: "ability-law", title: "观测限制", content: "能力只能读取不能改写", category: "law", mutability: "immutable" }]);
    const selection = selectChapterContext(createInputFixture({ chapterNo: 1, storyPlan: plan, worldRules: rules }));
    const ids = selection.sources.map((source) => source.id);
    expect(ids).toContain("chapter-plan-1");
    expect(ids).toContain("volume-plan-1");
    expect(ids).toContain("effective-world-rules");
    expect(selection.sources.find((source) => source.id === "chapter-plan-1")?.content).toContain("角色行为：su-jian=观察异常");
  });
});

/**
 * 运行时状态仓库单测：baseline 创建、delta 应用/重放/回滚、Markdown 投影渲染。
 */
import { describe, expect, it } from "vitest";
import type { RuntimeState, RuntimeStateView, StateDelta } from "../../schemas/runtimeStateSchemas.js";
import {
  applyStateDelta,
  createBaselineRuntimeState,
  removeChapterDelta,
  renderCurrentStateMarkdown,
  renderForeshadowingMarkdown,
  replayRuntimeState
} from "./runtimeStateRepository.js";

/** 构造最小权威状态视图夹具。 */
function createViewFixture(): RuntimeStateView {
  return {
    storyStart: "苏见在上学路上看见第一块系统面板",
    publicFacts: ["明和高中是故事舞台"],
    secrets: ["苏见是唯一无系统者"],
    nextGoals: ["接近陈栀了解面板任务"],
    characterStates: [{ characterId: "su-jian", state: "刚觉醒观测能力，仍在震惊中" }],
    factionStates: [],
    itemStates: [],
    foreshadowing: [
      { id: "mystery-1", content: "苏见能力来源不明", relatedEntityIds: ["su-jian"], placement: "第一卷", resolution: "终卷揭示", status: "planted", lastAdvancedChapter: null }
    ]
  };
}

describe("runtimeStateRepository", () => {
  it("createBaselineRuntimeState 从初始化视图创建 baseline 并补默认字段", () => {
    // 初始化 Bundle 的伏笔没有 lastAdvancedChapter 字段，也应被补为 null
    const raw = {
      storyStart: "起点",
      publicFacts: [],
      secrets: [],
      nextGoals: [],
      characterStates: [],
      factionStates: [],
      itemStates: [],
      foreshadowing: [{ id: "hook-1", content: "伏笔", relatedEntityIds: [], placement: "第一卷", resolution: "终卷", status: "planned" }]
    };

    const state = createBaselineRuntimeState(raw);

    expect(state.baseline.foreshadowing[0].lastAdvancedChapter).toBeNull();
    expect(state.deltas).toEqual([]);
    expect(state.state).toEqual(state.baseline);
  });

  it("applyStateDelta 应用章节 delta 并重放合成新状态（upsert 语义）", () => {
    const state = createBaselineRuntimeState(createViewFixture());
    const delta: StateDelta = {
      schemaVersion: "book-state-delta.v1",
      summary: "苏见观察到陈栀面板的隐藏注记",
      characterStates: [{ characterId: "su-jian", state: "已确认能力稳定，开始接近陈栀" }],
      foreshadowing: [
        { id: "mystery-1", content: "苏见能力来源不明", relatedEntityIds: ["su-jian"], placement: "第一卷", resolution: "终卷揭示", status: "resolving", lastAdvancedChapter: 2 }
      ]
    };

    const next = applyStateDelta(state, "chapter-0001", delta);

    expect(next.state.characterStates[0].state).toContain("已确认能力稳定");
    expect(next.state.foreshadowing[0].status).toBe("resolving");
    expect(next.state.foreshadowing[0].lastAdvancedChapter).toBe(2);
    expect(next.chapterSummaries["chapter-0001"]).toContain("隐藏注记");
    // 原始状态不可变：入参 state 不被修改
    expect(state.state.foreshadowing[0].status).toBe("planted");
  });

  it("同章重复保存时以后一条 delta 为准", () => {
    const state = createBaselineRuntimeState(createViewFixture());
    const first: StateDelta = { schemaVersion: "book-state-delta.v1", summary: "第一版" };
    const second: StateDelta = { schemaVersion: "book-state-delta.v1", summary: "第二版" };

    const afterFirst = applyStateDelta(state, "chapter-0001", first);
    const afterSecond = applyStateDelta(afterFirst, "chapter-0001", second);

    expect(afterSecond.deltas).toHaveLength(1);
    expect(afterSecond.chapterSummaries["chapter-0001"]).toBe("第二版");
  });

  it("删除章节时按 delta 序列回滚（排除被删章节的记录）", () => {
    const state = createBaselineRuntimeState(createViewFixture());
    const chapterOne: StateDelta = {
      schemaVersion: "book-state-delta.v1",
      characterStates: [{ characterId: "su-jian", state: "第一章后的状态" }]
    };
    const chapterTwo: StateDelta = {
      schemaVersion: "book-state-delta.v1",
      characterStates: [{ characterId: "su-jian", state: "第二章后的状态" }]
    };
    const afterOne = applyStateDelta(state, "chapter-0001", chapterOne);
    const afterTwo = applyStateDelta(afterOne, "chapter-0002", chapterTwo);

    // 删除第一章：重放时排除 chapter-0001，保留第二章
    const rolledBack = replayRuntimeState(afterTwo.baseline, afterTwo.deltas, "chapter-0001");

    expect(rolledBack.characterStates[0].state).toContain("第二章");
  });

  it("removeChapterDelta 移除章节 delta 与摘要并重放合成", () => {
    const state = createBaselineRuntimeState(createViewFixture());
    const chapterOne: StateDelta = {
      schemaVersion: "book-state-delta.v1",
      summary: "第一章摘要",
      characterStates: [{ characterId: "su-jian", state: "第一章后的状态" }]
    };
    const chapterTwo: StateDelta = {
      schemaVersion: "book-state-delta.v1",
      summary: "第二章摘要",
      characterStates: [{ characterId: "su-jian", state: "第二章后的状态" }]
    };
    const afterOne = applyStateDelta(state, "chapter-0001", chapterOne);
    const afterTwo = applyStateDelta(afterOne, "chapter-0002", chapterTwo);

    const rolledBack = removeChapterDelta(afterTwo, "chapter-0001");

    expect(rolledBack.deltas.map((record) => record.chapterId)).toEqual(["chapter-0002"]);
    expect(rolledBack.chapterSummaries["chapter-0001"]).toBeUndefined();
    expect(rolledBack.chapterSummaries["chapter-0002"]).toContain("第二章");
    expect(rolledBack.state.characterStates[0].state).toContain("第二章");
  });

  it("投影渲染输出当前状态与伏笔池 Markdown（实体 id 翻译为中文名）", () => {
    const state = createBaselineRuntimeState(createViewFixture());
    const entityNames = new Map([["su-jian", "苏见"]]);

    const current = renderCurrentStateMarkdown(state.state);
    const foreshadowing = renderForeshadowingMarkdown(state.state, entityNames);

    expect(current).toContain("# 当前状态");
    expect(current).toContain("**su-jian**");
    expect(foreshadowing).toContain("| ID | 伏笔 |");
    expect(foreshadowing).toContain("苏见（su-jian）");
    expect(foreshadowing).toContain("已埋设");
  });
});

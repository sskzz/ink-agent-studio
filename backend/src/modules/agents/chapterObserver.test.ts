/**
 * 章节观察者校验单测：状态增量业务校验（伏笔存在性、单向推进、章节号单调）。
 */
import { describe, expect, it } from "vitest";
import type { RuntimeState, StateDelta } from "../../schemas/runtimeStateSchemas.js";
import { validateStateDeltaAgainstCurrent } from "./chapterObserver.js";

/** 构造含两条伏笔的权威状态夹具。 */
function createRuntimeStateFixture(): RuntimeState {
  const view = {
    storyStart: "起点",
    publicFacts: [],
    secrets: [],
    nextGoals: [],
    characterStates: [],
    factionStates: [],
    itemStates: [],
    foreshadowing: [
      { id: "hook-a", content: "伏笔 A", relatedEntityIds: [], placement: "第一卷", resolution: "终卷", status: "planned" as const, lastAdvancedChapter: null },
      { id: "hook-b", content: "伏笔 B", relatedEntityIds: [], placement: "第一卷", resolution: "第二卷", status: "planted" as const, lastAdvancedChapter: 1 }
    ]
  };
  return {
    schemaVersion: "book-runtime-state.v1",
    baseline: view,
    deltas: [],
    history: [],
    state: view,
    chapterSummaries: {}
  };
}

describe("validateStateDeltaAgainstCurrent", () => {
  it("合法的状态推进（planned→planted、章节号递增）通过校验", () => {
    const delta: StateDelta = {
      schemaVersion: "book-state-delta.v1",
      foreshadowing: [
        { id: "hook-a", content: "伏笔 A", relatedEntityIds: [], placement: "第一卷", resolution: "终卷", status: "planted", lastAdvancedChapter: 2 }
      ]
    };

    expect(validateStateDeltaAgainstCurrent(delta, createRuntimeStateFixture())).toEqual([]);
  });

  it("拒绝不存在的伏笔 id（防止模型发明伏笔）", () => {
    const delta: StateDelta = {
      schemaVersion: "book-state-delta.v1",
      foreshadowing: [
        { id: "hook-invented", content: "凭空出现的伏笔", relatedEntityIds: [], placement: "第一卷", resolution: "终卷", status: "planted", lastAdvancedChapter: 2 }
      ]
    };

    const issues = validateStateDeltaAgainstCurrent(delta, createRuntimeStateFixture());

    expect(issues.some((issue) => issue.includes("hook-invented"))).toBe(true);
  });

  it("拒绝状态回退（resolved → planned 等）", () => {
    const delta: StateDelta = {
      schemaVersion: "book-state-delta.v1",
      foreshadowing: [
        { id: "hook-a", content: "伏笔 A", relatedEntityIds: [], placement: "第一卷", resolution: "终卷", status: "resolved", lastAdvancedChapter: 3 }
      ]
    };
    const state = createRuntimeStateFixture();
    // 先把 hook-a 推进到 resolved 再尝试回退
    state.state.foreshadowing[0].status = "resolved";
    state.state.foreshadowing[0].lastAdvancedChapter = 3;
    const regression: StateDelta = {
      schemaVersion: "book-state-delta.v1",
      foreshadowing: [
        { id: "hook-a", content: "伏笔 A", relatedEntityIds: [], placement: "第一卷", resolution: "终卷", status: "planted", lastAdvancedChapter: 3 }
      ]
    };

    const issues = validateStateDeltaAgainstCurrent(regression, state);

    expect(issues.some((issue) => issue.includes("不能回退"))).toBe(true);
  });

  it("拒绝推进章节号回退", () => {
    const state = createRuntimeStateFixture();
    // 现有推进章节号为 2，delta 尝试回退到 1
    state.state.foreshadowing[1].lastAdvancedChapter = 2;
    const delta: StateDelta = {
      schemaVersion: "book-state-delta.v1",
      foreshadowing: [
        { id: "hook-b", content: "伏笔 B", relatedEntityIds: [], placement: "第一卷", resolution: "第二卷", status: "resolving", lastAdvancedChapter: 1 }
      ]
    };

    const issues = validateStateDeltaAgainstCurrent(delta, state);

    expect(issues.some((issue) => issue.includes("章节号不能回退"))).toBe(true);
  });
});

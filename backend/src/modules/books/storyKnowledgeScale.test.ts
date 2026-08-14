import { describe, expect, it } from "vitest";
import { createInitialStoryPlan } from "./storyKnowledgeRepository.js";

describe("story knowledge scale", () => {
  it("1000 章拆成 50 个不跨卷的 20 章批次", () => {
    const plan = createInitialStoryPlan("book-scale", {
      mainLine: "主角跨越十卷完成长期目标。",
      estimatedChapters: 1_000,
      volumes: Array.from({ length: 10 }, (_, index) => ({
        title: `第 ${index + 1} 卷`,
        goal: `卷 ${index + 1} 目标`,
        conflict: `卷 ${index + 1} 冲突`,
        turningPoint: `卷 ${index + 1} 转折`,
        climax: `卷 ${index + 1} 高潮`,
        resolution: `卷 ${index + 1} 收束`,
        characterChanges: []
      })),
      terms: []
    });

    expect(plan.plannedChapterCount).toBe(1_000);
    expect(plan.batches).toHaveLength(50);
    expect(plan.batches.every((batch) => batch.chapterRange.end - batch.chapterRange.start + 1 === 20)).toBe(true);
    expect(plan.batches.every((batch) => plan.volumes.some((volume) =>
      batch.chapterRange.start >= volume.chapterRange.start && batch.chapterRange.end <= volume.chapterRange.end
    ))).toBe(true);
    expect(plan.batches.at(-1)?.chapterRange).toEqual({ start: 981, end: 1_000 });
  });
});

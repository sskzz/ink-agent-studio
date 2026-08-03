// 测试：writingStyleCompliance 符合度评估与重写指令构建。
import { describe, expect, it } from "vitest";
import { createWritingStyleFeatureProfile, extractWritingStyleFeatures } from "./writingStyleFeatures.js";
import { buildStyleRevisionInstruction, evaluateWritingStyleCompliance } from "./writingStyleCompliance.js";

describe("writing style compliance", () => {
  it("accepts text close to its source profile", () => {
    const content = Array.from({ length: 30 }, (_, index) =>
      index % 2 === 0 ? "她停在门边，没有说话。" : "风从半开的窗缝里钻进来，吹动桌上那张没有署名的纸。"
    ).join("\n");
    const profile = createWritingStyleFeatureProfile(extractWritingStyleFeatures(content, "sample.md").localStats);
    const report = evaluateWritingStyleCompliance(content, profile);

    expect(report.skipped).toBe(false);
    expect(report.passed).toBe(true);
    expect(report.score).toBe(100);
  });

  it("reports material rhythm deviations and builds a focused revision request", () => {
    const profile = {
      schemaVersion: "style-features.v1" as const,
      sourceContentLength: 1200,
      metrics: {
        averageSentenceLength: 10,
        sentenceLengthStdDev: 3,
        shortSentenceRatio: 0.9,
        longSentenceRatio: 0,
        averageLineLength: 20,
        independentShortParagraphRatio: 0.8,
        dialogueCharacterRatio: 0
      }
    };
    const content = `${"这是一个不断延伸并且始终没有停顿也没有切分的漫长句子".repeat(8)}。`.repeat(3);
    const report = evaluateWritingStyleCompliance(content, profile);

    expect(report.passed).toBe(false);
    expect(report.violations.some((item) => item.metric === "averageSentenceLength")).toBe(true);
    expect(buildStyleRevisionInstruction(report)).toContain("平均句长");
  });

  it("skips unreliable short comparisons", () => {
    const report = evaluateWritingStyleCompliance("很短。", {
      schemaVersion: "style-features.v1",
      sourceContentLength: 100,
      metrics: { averageSentenceLength: 10 }
    });
    expect(report.skipped).toBe(true);
    expect(report.score).toBeNull();
  });
});

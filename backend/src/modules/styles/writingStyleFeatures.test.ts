// 测试：writingStyleFeatures 特征提取与画像构建。
import { describe, expect, it } from "vitest";
import { createWritingStyleFeatureProfile, extractWritingStyleFeatures } from "./writingStyleFeatures.js";

describe("extractWritingStyleFeatures", () => {
  it("extracts deterministic sentence, dialogue and viewpoint statistics", () => {
    const result = extractWritingStyleFeatures(
      "我停在门口。\n\n“你来了？”她问。\n他没有回答，只把钥匙放在桌上！",
      "sample.md"
    );

    expect(result.localStats).toMatchObject({
      paragraphCount: 3,
      sentenceCount: 4,
      quoteLineCount: 1,
      firstPersonMarkerCount: 1,
      thirdPersonMarkerCount: 2,
      detectedFileType: "md"
    });
    expect(result.sampleContent).toContain("钥匙放在桌上");
  });

  it("samples across a long document and caps model context", () => {
    const paragraphs = Array.from({ length: 100 }, (_, index) => `第${index}段${"内容".repeat(80)}`);
    const result = extractWritingStyleFeatures(paragraphs.join("\n"), "novel.txt");

    expect(result.sampleContent.length).toBeLessThanOrEqual(4000);
    expect(result.sampleContent).toContain("第0段");
    expect(result.sampleContent).toContain("第99段");
    expect(result.localStats.sampledCharacterCount).toBe(result.sampleContent.length);
    expect(result.localStats.sampleTruncated).toBe(true);
  });

  it("builds a broad and explainable style profile", () => {
    const content = [
      "我们站在门口。风很冷。",
      "“你听见了吗？”",
      "“听见了。”",
      "她缓缓放下钥匙，却没有看我。",
      "因为她害怕，所以她没有回答。",
      "这不是离开，而是逃跑。归根结底，一切都结束了。"
    ].join("\n\n");
    const { localStats } = extractWritingStyleFeatures(content, "sample.txt");

    expect(localStats.firstPersonMarkerCount).toBe(2);
    expect(localStats.maxConsecutiveDialogueParagraphs).toBe(2);
    expect(localStats.dialogueCharacterRatio).toBeGreaterThan(0);
    expect(localStats.sentenceLengthStdDev).toBeGreaterThan(0);
    expect(localStats.psychologyWordDensity).toBeGreaterThan(0);
    expect(localStats.actionWordDensity).toBeGreaterThan(0);
    expect(localStats.causalExplanationDensity).toBeGreaterThan(0);
    expect(localStats.templatePatternDensity).toBeGreaterThan(0);
    expect(localStats.paragraphSummaryCandidateRatio).toBeGreaterThan(0);
    const profile = createWritingStyleFeatureProfile(localStats);
    expect(profile.schemaVersion).toBe("style-features.v2");
    expect(profile.metrics.averageSentenceLength).toBe(localStats.averageSentenceLength);
    expect(profile.metrics).not.toHaveProperty("sampledCharacterCount");
  });
});

// 写作风格样本质量 v2：章节标题不误判元数据，长文本重复只识别长片段和重复段落。
import { describe, expect, it } from "vitest";
import { createWritingStyleFeatureProfile, extractWritingStyleFeatures } from "./writingStyleFeatures.js";
import { assessWritingStyleSampleQuality } from "./writingStyleSampleQuality.js";

function assess(content: string) {
  const extracted = extractWritingStyleFeatures(content, "sample.txt");
  const profile = createWritingStyleFeatureProfile(extracted.localStats);
  return assessWritingStyleSampleQuality(content, profile, extracted.localStats);
}

function uniqueParagraph(index: number) {
  const unique = Array.from({ length: 12 }, (_, offset) => Math.imul(index + 1, 1_103_515_245 + offset * 12_345).toString(36)).join("");
  return `${unique}。`;
}

describe("writing style sample quality v2", () => {
  it("treats a chaptered long novel as narrative instead of metadata", () => {
    const content = Array.from({ length: 80 }, (_, index) => `第${index + 1}章 本章标题\n${uniqueParagraph(index)}`).join("\n");
    const quality = assess(content);
    expect(quality.detectedContentType).toBe("narrative");
    expect(quality.status).toBe("accepted");
    expect(quality.weight).toBe(1);
    expect(quality.diagnostics.headingRatio).toBeGreaterThan(0.4);
  });

  it("rejects a real outline only when list structure dominates and prose evidence is low", () => {
    const content = Array.from({ length: 20 }, (_, index) => `- 第${index + 1}幕：冲突节点、人物目标、转折安排`).join("\n");
    const quality = assess(content);
    expect(quality.detectedContentType).toBe("outline");
    expect(quality.status).toBe("rejected");
  });

  it("rejects metadata made of explicit key-value fields", () => {
    const content = ["书名：测试作品", "作者：测试作者", "分类：青春", "标签：恋爱", "状态：完结", "字数：200000", "来源：本地"].join("\n");
    const quality = assess(content.repeat(12));
    expect(quality.detectedContentType).toBe("metadata");
    expect(quality.status).toBe("rejected");
  });

  it("rejects extensively duplicated long passages but not natural long-text recurrence", () => {
    const natural = Array.from({ length: 120 }, (_, index) => uniqueParagraph(index)).join("\n");
    const duplicated = Array.from({ length: 120 }, () => "同一段广告文本被完整复制，下载地址与站点声明也完全相同。").join("\n");
    expect(assess(natural).status).toBe("accepted");
    expect(assess(duplicated).status).toBe("rejected");
  });
});

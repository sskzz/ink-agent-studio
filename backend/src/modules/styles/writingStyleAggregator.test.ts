// 测试：writingStyleAggregator 样本聚合与离群检测。
import { describe, expect, it } from "vitest";
import { aggregateWritingStyleSamples } from "./writingStyleAggregator.js";

describe("aggregateWritingStyleSamples", () => {
  it("uses robust statistics and identifies a distant outlier", () => {
    const values = [12, 13, 11, 80];
    const samples = values.map((value, index) => ({
      id: `sample-${index}`,
      styleId: "style-1",
      fileName: `${index}.txt`,
      contentPath: `samples/${index}.txt`,
      contentHash: `${index}`,
      contentLength: 1200,
      featureVersion: "style-features.v1",
      featureProfile: { schemaVersion: "style-features.v1" as const, sourceContentLength: 1200, metrics: { averageSentenceLength: value } },
      quality: { usable: true, weight: 1, detectedContentType: "narrative" as const, warnings: [] },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }));
    const aggregate = aggregateWritingStyleSamples(samples);
    expect(aggregate.metrics.averageSentenceLength?.median).toBe(12.5);
    expect(aggregate.metrics.averageSentenceLength?.outlierSampleIds).toContain("sample-3");
    expect(aggregate.validSampleCount).toBe(4);
  });

  it("keeps fewer than three samples as a soft, degraded profile", () => {
    const aggregate = aggregateWritingStyleSamples([]);
    expect(aggregate.status).toBe("degraded");
    expect(aggregate.warnings[0]).toContain("少于 3 篇");
  });
});

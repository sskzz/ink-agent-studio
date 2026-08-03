// 测试：styleMetricRegistry 度量定义域与夹取。
import { describe, expect, it } from "vitest";
import { clampStyleMetric } from "./styleMetricRegistry.js";

describe("style metric registry", () => {
  it("keeps ratio metrics inside zero and one", () => {
    expect(clampStyleMetric("dialogueCharacterRatio", 1.4)).toBe(1);
    expect(clampStyleMetric("shortSentenceRatio", -0.2)).toBe(0);
  });
});

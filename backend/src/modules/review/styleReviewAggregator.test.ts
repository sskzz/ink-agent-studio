// 测试：styleReviewAggregator 三路审稿合并。
import { describe, expect, it } from "vitest";
import { combineStyleReviews } from "./styleReviewAggregator.js";

describe("combineStyleReviews", () => {
  it("treats a high-severity viewpoint violation as a hard failure", () => {
    const result = combineStyleReviews({
      local: { passed: true, skipped: false, score: 95, sourceContentLength: 1000, generatedContentLength: 800, violations: [], warnings: [] },
      semantic: {
        schemaVersion: "semantic-style-review.v1",
        passed: false,
        score: 65,
        violations: [{ ruleId: "pov", category: "viewpoint", evidence: "他不知道她在想什么", reason: "越过当前视角人物认知", rewriteHint: "删去越界心理", severity: "high" }],
        warnings: []
      },
      stableMultiSample: true
    });
    expect(result.passed).toBe(false);
    expect(result.verificationStatus).toBe("failed");
    expect(result.hardFailures).toHaveLength(1);
  });

  it("marks the result unavailable instead of treating local score as a full pass", () => {
    const result = combineStyleReviews({
      local: { passed: true, skipped: false, score: 82, sourceContentLength: 1000, generatedContentLength: 800, violations: [], warnings: [] },
      semantic: null,
      semanticDegradedReason: "review unavailable",
      stableMultiSample: true
    });
    expect(result.passed).toBe(false);
    expect(result.verificationStatus).toBe("unavailable");
    expect(result.score).toBeNull();
    expect(result.degraded).toBe(true);
  });
});

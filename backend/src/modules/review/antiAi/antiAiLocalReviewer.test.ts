import { describe, expect, it } from "vitest";
import { compileAntiAiPolicy } from "./antiAiConstraintCompiler.js";
import { evaluateAntiAiCompliance } from "./antiAiLocalReviewer.js";

describe("evaluateAntiAiCompliance scene presence", () => {
  it("发现互动场景中的低对白与人物反应缺失", () => {
    const content = "苏见来到教室。他观察讲台，又观察窗边，然后回忆昨天发生的事情。".repeat(35);
    const review = evaluateAntiAiCompliance(content, compileAntiAiPolicy({ sceneType: "dialogue" }));

    expect(review.qualityMetrics.dialogueCharacterRatio).toBe(0);
    expect(review.violations.map((item) => item.ruleId)).toContain("scene-presence-low-interaction");
    expect(review.violations.map((item) => item.ruleId)).toContain("scene-presence-missing-reaction");
    expect(review.passed).toBe(false);
  });

  it("不对行动场景套用互动场景的对白阈值", () => {
    const content = "苏见踩住湿滑台阶，扶住栏杆，借着走廊灯光冲向门口。冷风贴过手背，他立刻缩手换了方向。".repeat(20);
    const review = evaluateAntiAiCompliance(content, compileAntiAiPolicy({ sceneType: "action" }));

    expect(review.violations.map((item) => item.ruleId)).not.toContain("scene-presence-low-interaction");
  });
});

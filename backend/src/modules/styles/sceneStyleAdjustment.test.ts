import { describe, expect, it } from "vitest";
import { getSceneStyleAdjustment } from "./sceneStyleAdjustment.js";

describe("scene style adjustment", () => {
  it("changes soft rhythm targets without defining viewpoint overrides", () => {
    const action = getSceneStyleAdjustment("action");
    expect(action.metricAdjustments.shortSentenceRatio?.centerDelta).toBeGreaterThan(0);
    expect(action.metricAdjustments).not.toHaveProperty("pointOfView");
  });
});

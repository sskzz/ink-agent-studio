import { describe, expect, it } from "vitest";
import { compileWritingStyleConstraints } from "./writingStyleConstraintCompiler.js";

describe("compileWritingStyleConstraints", () => {
  it("compiles a short fallback constraint for legacy styles without analysis", () => {
    const constraints = compileWritingStyleConstraints({
      id: "style-1",
      name: "冷静短篇",
      summary: "第三人称贴身视角，短段推进，情绪通过动作呈现。",
      parameters: { pacing: "短句推进", dialogue: "保留潜台词" },
      sampleFileName: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    expect(constraints.generationPrompt).toContain("第三人称贴身视角");
    expect(constraints.generationPrompt).toContain("短句推进");
    expect(constraints.reviewPrompt).toContain(constraints.generationPrompt);
    expect(constraints.generationPrompt.length).toBeLessThanOrEqual(350);
  });
});

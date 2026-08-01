import { describe, expect, it } from "vitest";
import { resolveGenerationConstraints } from "./constraintResolver.js";

describe("resolveGenerationConstraints", () => {
  it("keeps facts over conflicting style preferences and records the decision", () => {
    const result = resolveGenerationConstraints([
      { id: "world", key: "weather", source: "world", priority: 90, hard: true, text: "此地不会下雨" },
      { id: "style", key: "weather", source: "style-invariant", priority: 70, hard: true, text: "用雨景烘托情绪" }
    ]);
    expect(result.applied[0]?.id).toBe("world");
    expect(result.dropped[0]?.id).toBe("style");
    expect(result.conflicts).toHaveLength(1);
    expect(result.degraded).toBe(true);
  });
});

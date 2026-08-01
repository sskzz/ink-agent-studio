import { describe, expect, it } from "vitest";
import { selectWritingStyleSamples } from "./writingStyleSampleSelector.js";

describe("writing style sample selector", () => {
  it("keeps metadata out of semantic analysis and marks unknown samples weak", () => {
    const create = (id: string, type: "narrative" | "metadata" | "unknown", usable: boolean, weight: number) => ({
      id,
      styleId: "style",
      fileName: `${id}.txt`,
      contentPath: `${id}.txt`,
      contentHash: id,
      contentLength: 1000,
      featureVersion: "style-features.v1",
      featureProfile: { schemaVersion: "style-features.v1" as const, sourceContentLength: 1000, metrics: {} },
      quality: { usable, weight, detectedContentType: type, warnings: [] },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    const selection = selectWritingStyleSamples([
      create("good", "narrative", true, 1),
      create("meta", "metadata", false, 0.2),
      create("unknown", "unknown", true, 0.8)
    ]);
    expect(selection.accepted.map((sample) => sample.id)).toEqual(["good"]);
    expect(selection.weak.map((sample) => sample.id)).toEqual(["unknown"]);
    expect(selection.rejected.map((sample) => sample.id)).toEqual(["meta"]);
  });
});

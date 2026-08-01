import { describe, expect, it } from "vitest";
import { appConfigPatchSchema } from "./settings.js";

describe("appConfigPatchSchema", () => {
  it("accepts a bounded partial update", () => {
    const parsed = appConfigPatchSchema.parse({
      expectedRevision: 1,
      changes: { runtime: { globalConcurrency: 3 } }
    });

    expect(parsed.changes.runtime?.globalConcurrency).toBe(3);
  });

  it("rejects disabling patch approval", () => {
    expect(() => appConfigPatchSchema.parse({
      expectedRevision: 1,
      changes: { patches: { approvalRequired: false } }
    })).toThrow();
  });

  it("rejects disabling user-memory write approval", () => {
    expect(() => appConfigPatchSchema.parse({
      expectedRevision: 1,
      changes: { memory: { writeApprovalRequired: false } }
    })).toThrow();
  });
});

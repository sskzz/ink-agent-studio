import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { createApplicationServices } from "../runtime/applicationServices.js";

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe("settings routes", () => {
  it("reads and updates public settings without exposing secrets", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-settings-route-"));
    const services = createApplicationServices(createWorkspacePaths(tempRoot));
    const app = createApp(services);

    let response = await app.request("/api/v1/settings");
    expect(response.status).toBe(200);
    let payload = await response.json() as { data: { revision: number; effectiveConfig: { runtime: { globalConcurrency: number } } } };
    expect(payload.data.revision).toBe(1);

    response = await app.request("/api/v1/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 1,
        changes: { runtime: { globalConcurrency: 3 } }
      })
    });
    expect(response.status).toBe(200);
    payload = await response.json() as typeof payload;
    expect(payload.data.effectiveConfig.runtime.globalConcurrency).toBe(3);
    expect(JSON.stringify(payload)).not.toContain("INK_AGENT_SECRET_KEY");

    response = await app.request("/api/v1/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 1,
        changes: { runtime: { globalConcurrency: 4 } }
      })
    });
    expect(response.status).toBe(409);
  });
});

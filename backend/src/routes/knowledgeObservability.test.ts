import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { ensureWorkspace } from "../modules/workspace/workspaceService.js";
import { createApplicationServices, type ApplicationServices } from "../runtime/applicationServices.js";

let root: string | null = null;
let services: ApplicationServices | null = null;

afterEach(async () => {
  await services?.runCoordinator.shutdown(100);
  services?.runtimeDatabase.close();
  services = null;
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

describe("knowledge observability route", () => {
  it("聚合知识 Artifact 和模型实际 Token/费用", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "ink-agent-knowledge-observability-"));
    const paths = createWorkspacePaths(root);
    await ensureWorkspace(paths);
    services = createApplicationServices(paths);
    const config = await services.configService.initialize();
    await services.runtimeDatabase.initialize({ busyTimeoutMs: config.storage.sqliteBusyTimeoutMs, backupBeforeMigration: false });
    const run = services.runEventStore.createRun({
      command: { schemaVersion: "run-command.v1", type: "initialize_book", bookId: "book-1", input: {} },
      configRevision: 1, configHash: "hash"
    });
    services.runEventStore.saveInlineArtifact(run.id, {
      artifactType: "knowledge-observability.v1",
      value: { schemaVersion: "knowledge-observability.v1", knowledgeSourceIds: ["chapter-plan-1"] }
    });
    services.runEventStore.appendEvent(run.id, { type: "run_queued", payload: {} });
    services.runEventStore.appendEvent(run.id, { type: "run_started", payload: {} });
    const attempt = services.runEventStore.startModelAttempt(run.id, {
      stage: "generate", purpose: "writing", modelConfigId: "model-1", provider: "openai-compatible", model: "novel",
      attemptNumber: 1, requestHash: "request"
    });
    services.runEventStore.finishModelAttempt(attempt.id, {
      status: "completed", promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCostMicros: 1234, costCurrency: "USD", latencyMs: 20
    });

    const response = await createApp(services).request(`/api/v1/runs/${run.id}/knowledge-observability`);
    const payload = await response.json() as { data: { actualUsage: { totalTokens: number; estimatedCostMicros: number }; observability: unknown } };
    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({ actualUsage: { totalTokens: 150, estimatedCostMicros: 1234 }, observability: { knowledgeSourceIds: ["chapter-plan-1"] } });
  });
});

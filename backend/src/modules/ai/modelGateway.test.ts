import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultAppConfig } from "../../config/defaultAppConfig.js";
import { RuntimeDatabase } from "../../runtime/database/runtimeDatabase.js";
import type { ModelConfigRecord } from "../../types/domain.js";
import { writeJsonFile } from "../../utils/jsonStore.js";
import { RunEventStore } from "../agents/runEventStore.js";
import { createWorkspacePaths, type WorkspacePaths } from "../workspace/workspacePaths.js";
import { ensureWorkspace } from "../workspace/workspaceService.js";
import { generateModelTextWithFallback } from "./modelGateway.js";
import { runWithModelExecutionContext } from "./modelExecutionContext.js";
import { ModelGatewayError } from "./modelGatewayError.js";

let tempRoot: string | null = null;
let runtimeDatabase: RuntimeDatabase | null = null;
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  runtimeDatabase?.close();
  runtimeDatabase = null;
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

async function createFixture() {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-model-gateway-"));
  const paths = createWorkspacePaths(tempRoot);
  await ensureWorkspace(paths);
  runtimeDatabase = new RuntimeDatabase(paths);
  await runtimeDatabase.initialize({ busyTimeoutMs: 1_000, backupBeforeMigration: false });
  const eventStore = new RunEventStore(runtimeDatabase);
  const run = eventStore.createRun({
    command: {
      schemaVersion: "run-command.v1",
      type: "continue_chapter",
      bookId: "book-1",
      chapterId: "chapter-1",
      input: { instruction: "继续写", selectedContextFileIds: [], sceneType: "auto", allowDegradedStyle: false }
    },
    configRevision: 1,
    configHash: "test-config"
  });
  eventStore.appendEvent(run.id, { type: "run_started", payload: {} });
  eventStore.appendEvent(run.id, { type: "stage_started", stage: "generate", payload: {} });
  return { paths, eventStore, runId: run.id };
}

function model(id: string, baseUrl: string, capabilities: Record<string, unknown> = {}): ModelConfigRecord {
  return {
    id,
    name: id,
    provider: "openai-compatible",
    baseUrl,
    apiModel: `${id}-api`,
    purpose: "writing",
    enabled: true,
    isDefault: false,
    capabilities,
    note: "",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
}

function policy(maxAttemptsPerModel = 2, maxTotalAttempts = 4) {
  return {
    ...defaultAppConfig.models,
    defaultTimeoutMs: 1_000,
    retry: { maxAttemptsPerModel, maxTotalAttempts, baseDelayMs: 1, maxDelayMs: 2 }
  };
}

async function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("测试服务器监听失败");
  return `http://127.0.0.1:${address.port}`;
}

function ok(text = "正文", usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }) {
  return JSON.stringify({ choices: [{ message: { content: text } }], usage });
}

async function execute(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  primary: ModelConfigRecord,
  fallbackModels: ModelConfigRecord[],
  controller = new AbortController(),
  input: { timeoutMs?: number; stream?: boolean } = {}
) {
  return runWithModelExecutionContext({
    runId: fixture.runId,
    stage: "generate",
    signal: controller.signal,
    eventStore: fixture.eventStore,
    modelPolicy: policy()
  }, () => generateModelTextWithFallback(fixture.paths, primary, {
    systemPrompt: "system",
    userPrompt: "user",
    stream: input.stream,
    timeoutMs: input.timeoutMs
  }, {
    fallbackModels,
    retry: policy().retry,
    random: () => 0.5
  }));
}

describe("resilient model gateway", () => {
  it("retries a transient error and persists token, latency and cost statistics", async () => {
    const fixture = await createFixture();
    let calls = 0;
    const baseUrl = await listen((_request, response) => {
      calls += 1;
      response.statusCode = calls === 1 ? 503 : 200;
      response.setHeader("Content-Type", "application/json");
      response.end(calls === 1 ? JSON.stringify({ secret: "must-not-persist" }) : ok());
    });
    const primary = model("primary", baseUrl, {
      pricing: { currency: "USD", promptMicrosPerMillionTokens: 2_000_000, completionMicrosPerMillionTokens: 4_000_000 }
    });

    const result = await execute(fixture, primary, []);

    expect(result.text).toBe("正文");
    expect(calls).toBe(2);
    expect(fixture.eventStore.listModelAttempts(fixture.runId)).toMatchObject([
      { status: "failed", modelConfigId: "primary", error: { kind: "unavailable", status: 503 } },
      {
        status: "completed",
        modelConfigId: "primary",
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        estimatedCostMicros: 400,
        costCurrency: "USD",
        latencyMs: expect.any(Number)
      }
    ]);
    expect(JSON.stringify(fixture.eventStore.listModelAttempts(fixture.runId))).not.toContain("must-not-persist");
  });

  it("falls back after the primary model is exhausted and enforces the total attempt cap", async () => {
    const fixture = await createFixture();
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const primaryUrl = await listen((_request, response) => {
      primaryCalls += 1;
      response.statusCode = 503;
      response.end();
    });
    const fallbackUrl = await listen((_request, response) => {
      fallbackCalls += 1;
      response.setHeader("Content-Type", "application/json");
      response.end(ok("fallback"));
    });
    const primary = model("primary", primaryUrl);
    const fallback = model("fallback", fallbackUrl);

    const result = await runWithModelExecutionContext({
      runId: fixture.runId,
      stage: "generate",
      signal: new AbortController().signal,
      eventStore: fixture.eventStore,
      modelPolicy: policy(2, 3)
    }, () => generateModelTextWithFallback(fixture.paths, primary, {
      systemPrompt: "system",
      userPrompt: "user"
    }, {
      fallbackModels: [fallback],
      retry: policy(2, 3).retry,
      random: () => 0.5
    }));

    expect(result.text).toBe("fallback");
    expect(primaryCalls).toBe(2);
    expect(fallbackCalls).toBe(1);
    expect(fixture.eventStore.listModelAttempts(fixture.runId)).toHaveLength(3);
  });

  it("falls back to routed models when purpose metadata is stale", async () => {
    const fixture = await createFixture();
    let primaryCalls = 0;
    let routedCalls = 0;
    const primaryUrl = await listen((_request, response) => {
      primaryCalls += 1;
      response.statusCode = 503;
      response.end();
    });
    const routedUrl = await listen((_request, response) => {
      routedCalls += 1;
      response.setHeader("Content-Type", "application/json");
      response.end(ok("routed fallback"));
    });
    const primary = { ...model("primary", primaryUrl), purpose: "review" as const, isDefault: true };
    const routed = { ...model("routed", routedUrl), purpose: "writing" as const };
    await writeJsonFile(fixture.paths.modelConfigsFile, [primary, routed]);
    await writeJsonFile(fixture.paths.modelRoutesFile, {
      writingModelId: routed.id,
      reviewModelId: null,
      planningModelId: primary.id
    });

    const result = await runWithModelExecutionContext({
      runId: fixture.runId,
      stage: "generate",
      signal: new AbortController().signal,
      eventStore: fixture.eventStore,
      modelPolicy: policy(2, 3)
    }, () => generateModelTextWithFallback(fixture.paths, primary, {
      systemPrompt: "system",
      userPrompt: "user"
    }, {
      purpose: "planning",
      retry: policy(2, 3).retry,
      random: () => 0.5
    }));

    expect(result.text).toBe("routed fallback");
    expect(primaryCalls).toBe(2);
    expect(routedCalls).toBe(1);
    expect(fixture.eventStore.listModelAttempts(fixture.runId).map((attempt) => attempt.modelConfigId))
      .toEqual(["primary", "primary", "routed"]);
  });

  it("does not retry authentication or invalid-request failures", async () => {
    for (const status of [401, 400]) {
      const fixture = await createFixture();
      let calls = 0;
      const baseUrl = await listen((_request, response) => {
        calls += 1;
        response.statusCode = status;
        response.end();
      });

      await expect(execute(fixture, model(`model-${status}`, baseUrl), [])).rejects.toMatchObject({
        status,
        retryable: false
      });
      expect(calls).toBe(1);
      expect(fixture.eventStore.listModelAttempts(fixture.runId)).toHaveLength(1);
      runtimeDatabase?.close();
      runtimeDatabase = null;
      if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it("classifies per-attempt timeout separately from external cancellation", async () => {
    const fixture = await createFixture();
    const baseUrl = await listen(() => undefined);
    await expect(execute(fixture, model("timeout", baseUrl), [], new AbortController(), { timeoutMs: 20 }))
      .rejects.toMatchObject({ kind: "timeout" });
    expect(fixture.eventStore.listModelAttempts(fixture.runId).every((attempt) => attempt.status === "timed_out"))
      .toBe(true);

    runtimeDatabase?.close();
    runtimeDatabase = null;
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;

    const cancelledFixture = await createFixture();
    const cancelledUrl = await listen(() => undefined);
    const controller = new AbortController();
    const pending = execute(cancelledFixture, model("cancelled", cancelledUrl), [], controller, { timeoutMs: 5_000 });
    setTimeout(() => controller.abort(new Error("user supplied secret reason")), 10);

    await expect(pending).rejects.toBeInstanceOf(ModelGatewayError);
    await expect(pending).rejects.toMatchObject({ kind: "cancelled" });
    expect(cancelledFixture.eventStore.listModelAttempts(cancelledFixture.runId)).toMatchObject([
      { status: "cancelled", error: { kind: "cancelled", message: "模型调用已取消" } }
    ]);
  });

  it("keeps the timeout active while the response body is still streaming", async () => {
    const fixture = await createFixture();
    const baseUrl = await listen((_request, response) => {
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.flushHeaders();
      setTimeout(() => response.end(ok()), 200);
    });

    await expect(execute(fixture, model("slow-body", baseUrl), [], new AbortController(), { timeoutMs: 20 }))
      .rejects.toMatchObject({ kind: "timeout" });
    expect(fixture.eventStore.listModelAttempts(fixture.runId).every((attempt) => attempt.status === "timed_out"))
      .toBe(true);
  });

  it("requests and assembles OpenAI-compatible SSE streaming responses", async () => {
    const fixture = await createFixture();
    let requestBody: Record<string, unknown> | null = null;
    const baseUrl = await listen((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/event-stream");
        response.write('data: {"choices":[{"delta":{"content":"{\\\"answer\\\":"}}]}\n\n');
        response.write('data: {"choices":[{"delta":{"content":"\\\"ok\\\"}"}}]}\n\n');
        response.write('data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":4,"total_tokens":16}}\n\n');
        response.end("data: [DONE]\n\n");
      });
    });

    const result = await execute(fixture, model("streaming", baseUrl), [], new AbortController(), { stream: true });

    expect(requestBody).toMatchObject({ stream: true });
    expect(result).toMatchObject({
      text: '{"answer":"ok"}',
      tokenUsage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 },
      raw: { stream: true, chunkCount: 3 }
    });
  });

  it("cancels an in-progress retry backoff before another HTTP attempt starts", async () => {
    const fixture = await createFixture();
    let calls = 0;
    const baseUrl = await listen((_request, response) => {
      calls += 1;
      response.statusCode = 503;
      response.end();
    });
    const controller = new AbortController();
    const pending = runWithModelExecutionContext({
      runId: fixture.runId,
      stage: "generate",
      signal: controller.signal,
      eventStore: fixture.eventStore,
      modelPolicy: policy()
    }, () => generateModelTextWithFallback(fixture.paths, model("primary", baseUrl), {
      systemPrompt: "system",
      userPrompt: "user"
    }, {
      fallbackModels: [],
      retry: { maxAttemptsPerModel: 3, maxTotalAttempts: 3, baseDelayMs: 5_000, maxDelayMs: 5_000 },
      random: () => 0.5
    }));
    while (calls === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ kind: "cancelled" });
    expect(calls).toBe(1);
  });
});

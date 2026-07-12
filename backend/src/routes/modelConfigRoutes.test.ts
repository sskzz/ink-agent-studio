import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";

interface ApiPayload<T> {
  data: T;
}

let tempRoot: string | null = null;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-model-routes-"));
  process.env.INK_AGENT_DATA_DIR = tempRoot;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
  delete process.env.INK_AGENT_DATA_DIR;
});

describe("model configuration routes", () => {
  it("treats an enabled assigned model as route-ready regardless of its purpose label", async () => {
    const app = createApp();
    let response = await app.request("/api/v1/model-configs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Shared model",
        provider: "openai-compatible",
        baseUrl: "https://models.example/v1",
        apiKey: "test-key",
        apiModel: "shared-chat",
        purpose: "writing"
      })
    });
    const created = (await response.json()) as ApiPayload<{ id: string }>;

    response = await app.request("/api/v1/model-routes/review", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelConfigId: created.data.id })
    });
    expect(response.status).toBe(200);

    response = await app.request("/api/v1/model-analysis");
    const analysis = (await response.json()) as ApiPayload<{
      routes: Array<{ routeKey: string; ready: boolean; issues: string[] }>;
    }>;
    const reviewRoute = analysis.data.routes.find((route) => route.routeKey === "reviewModelId");
    expect(reviewRoute).toMatchObject({ ready: true, issues: [] });
  });

  it("discovers, deduplicates and sorts models exposed by the configured API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ data: [{ id: "model-z" }, { id: "model-a" }, { id: "model-z" }] }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );
    const app = createApp();
    const response = await app.request("/api/v1/model-configs/discover-models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "openai-compatible",
        baseUrl: "https://models.example/v1",
        apiKey: "test-key"
      })
    });
    const payload = (await response.json()) as ApiPayload<{ models: string[] }>;

    expect(response.status).toBe(200);
    expect(payload.data.models).toEqual(["model-a", "model-z"]);
    expect(fetch).toHaveBeenCalledWith(
      "https://models.example/v1/models",
      expect.objectContaining({ headers: { Authorization: "Bearer test-key" } })
    );
  });

  it("returns a readable discovery error when the model API returns HTML", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("<!doctype html><html><body>login</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" }
        })
      )
    );
    const app = createApp();
    const response = await app.request("/api/v1/model-configs/discover-models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "openai-compatible",
        baseUrl: "https://models.example/v1",
        apiKey: "test-key"
      })
    });
    const payload = (await response.json()) as { message: string };

    expect(response.status).toBe(400);
    expect(payload.message).toContain("接口返回了 HTML");
  });
});

// 反 AI 味约束路由测试：只读概览接口暴露版本化规则注册表，写操作返回 404。
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";

describe("anti-ai constraint routes", () => {
  it("exposes the versioned global registry through read-only endpoints", async () => {
    const app = createApp();
    const response = await app.request("/api/v1/anti-ai-constraints");
    const body = await response.json() as { data: { version: string; ruleCount: number; rules: unknown[] } };

    expect(response.status).toBe(200);
    expect(body.data.version).toBe("anti-ai-rules.v1");
    expect(body.data.ruleCount).toBeGreaterThan(0);
    expect(body.data.rules).toHaveLength(body.data.ruleCount);

    const writeResponse = await app.request("/api/v1/anti-ai-constraints", { method: "POST" });
    expect(writeResponse.status).toBe(404);
  });
});


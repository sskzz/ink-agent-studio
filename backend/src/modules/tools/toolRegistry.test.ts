// 测试文件：工具注册表的注册、列表与入参校验。
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "./toolRegistry.js";

describe("ToolRegistry", () => {
  it("lists definitions and validates input before execution", async () => {
    const registry = new ToolRegistry().register({
      name: "test_tool",
      description: "测试工具",
      inputSchema: z.object({ value: z.string().min(1) }),
      requiresApproval: false,
      async execute(_context, input) { return { value: input.value.toUpperCase() }; }
    });
    expect(registry.list()).toEqual([{ name: "test_tool", description: "测试工具", requiresApproval: false }]);
    await expect(registry.execute("test_tool", { paths: {} as never, bookId: "book" }, { value: "ok" }))
      .resolves.toEqual({ value: "OK" });
    await expect(registry.execute("test_tool", { paths: {} as never, bookId: "book" }, { value: "" }))
      .rejects.toThrow();
  });
});

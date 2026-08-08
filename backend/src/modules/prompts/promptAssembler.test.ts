// 测试文件：PromptAssembler 的预算约束、当前指令保留与哈希稳定性。
import { describe, expect, it } from "vitest";
import { PromptAssembler } from "./promptAssembler.js";

function layers(factContent = "世界事实".repeat(50)) {
  return [
    { name: "stable" as const, budgetTokens: 100, sources: [{ id: "rules", label: "规则", content: "只输出正文", priority: 100 }] },
    { name: "facts" as const, budgetTokens: 30, sources: [{ id: "world", label: "世界观", content: factContent, priority: 10, sourceRef: { fileId: "world" } }] },
    { name: "memory" as const, budgetTokens: 30, sources: [{ id: "preference", label: "用户偏好", content: "偏好短段落", priority: 50, sourceRef: { type: "user-memory" } }] },
    { name: "scene" as const, budgetTokens: 40, sources: [{ id: "chapter", label: "当前章节", content: "已有正文", priority: 50 }] },
    { name: "skills" as const, budgetTokens: 30, sources: [{ id: "skill", label: "技能", content: "从末尾动作续写", priority: 50 }] },
    { name: "turn" as const, budgetTokens: 40, sources: [{ id: "instruction", label: "本次指令", content: "让主角立即离开", priority: 100, minTokens: 10 }] }
  ];
}

describe("PromptAssembler", () => {
  it("enforces per-layer budgets while preserving the current instruction", () => {
    const result = new PromptAssembler().assemble(layers());

    expect(result.userPrompt).toContain("让主角立即离开");
    expect(result.trace.layers.every((layer) => layer.estimatedTokens <= layer.budgetTokens)).toBe(true);
    expect(result.trace.layers.find((layer) => layer.name === "facts")?.truncated).toBe(true);
    expect(result.trace.layers[1].sources[0].sourceRef).toEqual({ fileId: "world" });
    expect(result.trace.layers[1].sources[0].status).toBe("truncated");
    expect(result.trace.layers.map((layer) => layer.name)).toEqual(["stable", "facts", "memory", "scene", "skills", "turn"]);
  });

  it("produces stable hashes and changes them when source content changes", () => {
    const assembler = new PromptAssembler();
    const first = assembler.assemble(layers("事实 A"));
    const repeated = assembler.assemble(layers("事实 A"));
    const changed = assembler.assemble(layers("事实 B"));

    expect(repeated.trace.promptHash).toBe(first.trace.promptHash);
    expect(changed.trace.promptHash).not.toBe(first.trace.promptHash);
  });
});

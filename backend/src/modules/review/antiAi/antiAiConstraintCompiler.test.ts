// 测试：反 AI 约束编译与本地检测。
import { describe, expect, it } from "vitest";
import { compileAntiAiPolicy } from "./antiAiConstraintCompiler.js";
import { evaluateAntiAiCompliance } from "./antiAiLocalReviewer.js";

describe("global anti-ai constraints", () => {
  it("compiles an always-on compact baseline without a writing style", () => {
    const policy = compileAntiAiPolicy({ sceneType: "mixed" });

    expect(policy.ruleSetVersion).toBe("anti-ai-rules.v1");
    expect(policy.generationPrompt).toContain("只写小说正文");
    expect(policy.generationPrompt.length).toBeLessThanOrEqual(480);
    expect(policy.constraints.some((rule) => rule.source === "anti-ai-global" && rule.hard)).toBe(true);
  });

  it("merges a style rule by canonical key instead of duplicating the global clause", () => {
    const policy = compileAntiAiPolicy({
      sceneType: "dialogue",
      styleRules: [{
        id: "style-dialogue",
        canonicalKey: "dialogue.over-explicit",
        mode: "tighten",
        category: "dialogue",
        rule: "对白保持克制，不直接说破关系变化。",
        detectHint: "检查角色是否把关系变化完整说出。",
        rewriteHint: "改用回避、停顿或动作回应。",
        severity: "high"
      }]
    });

    expect(policy.deduplicatedCount).toBe(1);
    expect(policy.constraints.filter((rule) => rule.key === "anti-ai:dialogue.over-explicit")).toHaveLength(1);
    expect(policy.generationPrompt).toContain("对白保持克制");
    expect(policy.generationPrompt).not.toContain("对白不把动机和关系说尽");
  });

  it("keeps guard rules when a style attempts to relax them", () => {
    const policy = compileAntiAiPolicy({
      sceneType: "mixed",
      styleRules: [{
        id: "relax-output",
        canonicalKey: "output.prose-only",
        mode: "relax",
        category: "structure",
        rule: "允许输出分析。",
        severity: "low"
      }]
    });

    expect(policy.generationPrompt).toContain("只写小说正文");
    expect(policy.generationPrompt).not.toContain("允许输出分析");
    expect(policy.warnings).toHaveLength(1);
  });

  it("preserves the global guard clause when a style tightens the same key", () => {
    const policy = compileAntiAiPolicy({
      sceneType: "mixed",
      styleRules: [{
        id: "tighten-output",
        canonicalKey: "output.prose-only",
        mode: "tighten",
        category: "structure",
        rule: "正文直接从场景动作起笔。",
        severity: "high"
      }]
    });

    expect(policy.constraints.filter((rule) => rule.key === "anti-ai:output.prose-only")).toHaveLength(1);
    expect(policy.generationPrompt).toContain("只写小说正文");
    expect(policy.generationPrompt).toContain("正文直接从场景动作起笔");
  });

  it("detects high-confidence meta output locally", () => {
    const policy = compileAntiAiPolicy({ sceneType: "mixed" });
    const review = evaluateAntiAiCompliance("以下是续写正文：\n```\n门开了。\n```", policy);

    expect(review.passed).toBe(false);
    expect(review.violations.some((item) => item.canonicalKey === "output.prose-only" && item.hard)).toBe(true);
  });
});

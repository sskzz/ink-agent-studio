import { describe, expect, it } from "vitest";
import type { BookEntityRecord } from "../../types/domain.js";
import { validatePlannedCharacterConsistency } from "../agents/characterConsistency.js";
import { scheduleForeshadowing } from "./foreshadowingScheduler.js";
import {
  applyWorldRuleProposals,
  auditStoryPlanBatch,
  createInitialStoryPlan,
  createInitialWorldRuleRegistry,
  normalizeCharacterProfile,
  reviewWorldRuleProposal
} from "./storyKnowledgeRepository.js";

const basePlan = createInitialStoryPlan("book-1", {
  mainLine: "主角追查失踪真相",
  estimatedChapters: 50,
  volumes: [{
    title: "开局卷", goal: "找到第一条线索", conflict: "敌人封锁线索", turningPoint: "盟友反水", climax: "闯入禁区", resolution: "带走证据", characterChanges: ["主角学会合作"]
  }],
  terms: [{ id: "hero-lin", term: "林夕", category: "character" }]
});

function chapter(chapterNo: number, characterId = "hero-lin") {
  return {
    chapterNo,
    volumeNo: 1,
    title: `第${chapterNo}章`,
    dimensions: {
      synopsis: `林夕在第${chapterNo}章推进调查并遭遇明确阻力`,
      characterActions: [{ characterId, action: "调查旧塔" }],
      scenes: ["旧塔入口交锋", "线索反转"],
      conflicts: ["守卫阻拦"],
      narrativeGoals: ["推进失踪案线索"]
    },
    lockedTermIds: ["hero-lin"],
    status: "draft" as const,
    reviewNotes: []
  };
}

describe("story knowledge repository", () => {
  it("按需创建最多 1000 章的三层大纲壳，不预生成章级内容", () => {
    const plan = createInitialStoryPlan("book-1", {
      mainLine: "主线", estimatedChapters: 1_200,
      volumes: [{ title: "卷一", goal: "目标", conflict: "冲突", turningPoint: "转折", climax: "高潮", resolution: "收束", characterChanges: [] }],
      terms: []
    });
    expect(plan.plannedChapterCount).toBe(1_000);
    expect(plan.chapters).toEqual([]);
    expect(plan.batches).toHaveLength(50);
    expect(plan.batches[0].chapterRange).toEqual({ start: 1, end: 20 });
  });

  it("质量闸门拒绝缺章和未知角色，防止半成品大纲进入权威存储", () => {
    const result = auditStoryPlanBatch(basePlan, [chapter(1), chapter(2, "unknown-role")], new Set(["hero-lin"]));
    expect(result.passed).toBe(false);
    expect(result.blockingIssues.some((issue) => issue.includes("缺少第 3 章"))).toBe(true);
    expect(result.blockingIssues.some((issue) => issue.includes("未知角色"))).toBe(true);
  });

  it("逾期两次的伏笔升级为强制回收，已回收伏笔不再触发", () => {
    const result = scheduleForeshadowing([
      { id: "hook-a", content: "钥匙的代价", relatedEntityIds: [], placement: "第 1 章", resolution: "第 3 章", status: "resolving", missedCount: 2, lastAdvancedChapter: 1 },
      { id: "hook-b", content: "已结束", relatedEntityIds: [], placement: "第 1 章", resolution: "第 2 章", status: "resolved", missedCount: 9, lastAdvancedChapter: 2 }
    ], 4);
    expect(result[0]).toMatchObject({ scheduleStatus: "overdue", forceRecovery: true });
    expect(result[1]).toMatchObject({ scheduleStatus: "on_track", forceRecovery: false });
  });

  it("世界新事实在带正文证据时自动入库，规则改写保留人工审核", () => {
    const registry = createInitialWorldRuleRegistry("book-1", [{ id: "moon-law", title: "月潮", content: "月潮只能持续一刻钟", category: "law", mutability: "immutable" }]);
    const next = applyWorldRuleProposals(registry, 3, [
      { kind: "new_fact", title: "旧塔入口", content: "旧塔入口在月潮时才显现", evidence: "正文：月潮涌上石阶，旧塔门缝亮起。" },
      { kind: "rule_update", title: "改写月潮", content: "月潮可以持续一小时", evidence: "正文提及异常", targetRuleId: "moon-law" }
    ]);
    expect(next.rules.some((rule) => rule.title === "旧塔入口" && rule.source === "chapter-observer")).toBe(true);
    expect(next.proposals.find((proposal) => proposal.kind === "rule_update")?.status).toBe("proposed");
  });

  it("人工批准规则改写时保留旧版本并创建可追溯的新版本", () => {
    const registry = createInitialWorldRuleRegistry("book-1", [
      { id: "moon-law", title: "月潮", content: "月潮只能持续一刻钟", category: "law", mutability: "immutable" }
    ]);
    const proposed = applyWorldRuleProposals(registry, 3, [
      { kind: "rule_update", title: "异常月潮", content: "红月之夜月潮会持续一小时", evidence: "第三章明确出现异常月潮", targetRuleId: "moon-law" }
    ]);
    const proposal = proposed.proposals.find((item) => item.status === "proposed")!;
    const reviewed = reviewWorldRuleProposal(proposed, proposal.id, true, "作者确认异常条件成立");

    expect(reviewed.rules.find((rule) => rule.id === "moon-law")?.status).toBe("superseded");
    expect(reviewed.rules.find((rule) => rule.status === "active")?.content).toContain("红月之夜");
    expect(reviewed.proposals.find((item) => item.id === proposal.id)).toMatchObject({
      status: "applied",
      reason: "作者确认异常条件成立"
    });
  });

  it("角色五层档案的禁止行为会阻断章纲中的直接违反", () => {
    const profile = normalizeCharacterProfile({ prohibitedActions: ["杀害无辜者"] }, { description: "克制的调查者" });
    const entity: BookEntityRecord = {
      id: "hero-lin", bookId: "book-1", entityType: "character", name: "林夕", role: "主要", description: "调查者", fileId: null,
      attributes: { profile }, createdAt: "", updatedAt: ""
    };
    const inconsistent = { ...chapter(1), dimensions: { ...chapter(1).dimensions, characterActions: [{ characterId: "hero-lin", action: "杀害无辜者以换取线索" }] } };
    expect(validatePlannedCharacterConsistency(inconsistent, [entity])[0]).toContain("违反已锁定禁止行为");
  });
});

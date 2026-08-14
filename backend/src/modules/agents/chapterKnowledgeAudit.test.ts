import { describe, expect, it } from "vitest";
import type { RuntimeForeshadowing } from "../../schemas/runtimeStateSchemas.js";
import type { StoryPlanChapter, WorldRuleRegistry } from "../../schemas/storyKnowledgeSchemas.js";
import type { BookEntityRecord } from "../../types/domain.js";
import { auditChapterKnowledge } from "./chapterKnowledgeAudit.js";

const plannedChapter: StoryPlanChapter = {
  chapterNo: 12,
  volumeNo: 1,
  title: "月钥之夜",
  dimensions: {
    synopsis: "林夕使用月钥寻找姐姐。",
    characterActions: [{ characterId: "hero-lin", action: "林夕进入遗迹" }],
    scenes: ["遗迹入口"],
    conflicts: ["守卫阻拦"],
    narrativeGoals: ["揭示月钥代价"]
  },
  lockedTermIds: ["term-moon-key"],
  status: "approved",
  reviewNotes: []
};

const character: BookEntityRecord = {
  id: "hero-lin",
  bookId: "book-1",
  entityType: "character",
  name: "林夕",
  role: "主角",
  description: "寻找姐姐",
  fileId: null,
  attributes: {
    aliases: ["小夕"],
    profile: {
      schemaVersion: "character-profile.v1",
      core: {
        appearance: "黑发",
        personalityTraits: ["谨慎"],
        motivations: ["寻找姐姐"],
        values: [],
        hardConstraints: ["不得：主动伤害无辜者"],
        prohibitedActions: ["背叛姐姐"]
      },
      arc: { startState: "孤立", targetState: "信任同伴", milestones: [] },
      timeline: { currentState: "进入遗迹", knownHistory: [] },
      relationships: [],
      dialogueDna: {
        voice: "克制",
        sentenceRhythm: "短句",
        signaturePhrases: [],
        forbiddenExpressions: ["随便吧"],
        subtextHabits: []
      }
    }
  },
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString()
};

function worldRules(): WorldRuleRegistry {
  return {
    schemaVersion: "world-rule-registry.v1",
    bookId: "book-1",
    rules: [{
      id: "rule-death",
      title: "死亡不可逆",
      content: "死亡是不可逆过程。",
      category: "law",
      mutability: "immutable",
      prohibitedExpressions: ["成功复活死者"],
      status: "active",
      source: "initialization",
      sourceChapterNo: null,
      evidence: "初始设定",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    }],
    proposals: [],
    updatedAt: new Date(0).toISOString()
  };
}

function forcedForeshadowing(): RuntimeForeshadowing[] {
  return [{
    id: "hook-sister",
    content: "姐姐失踪与王城有关",
    relatedEntityIds: ["hero-lin"],
    placement: "第 2 章",
    resolution: "第 10 章揭示姐姐被王城囚禁",
    targetChapterRange: { start: 9, end: 10 },
    status: "advancing",
    missedCount: 2,
    lastAdvancedChapter: 8
  }];
}

function audit(content: string) {
  return auditChapterKnowledge({
    content,
    chapterNo: 12,
    plannedChapter,
    terms: [{ id: "term-moon-key", term: "月钥", aliases: ["月之钥"], locked: true }],
    entities: [character],
    worldRules: worldRules(),
    foreshadowing: forcedForeshadowing()
  });
}

describe("auditChapterKnowledge", () => {
  it("阻断人物禁行、禁用对白、锁定专名、不可变规则和漏回收伏笔", () => {
    const report = audit("林夕握住月之钥，说：“随便吧。”随后林夕背叛姐姐，并成功复活死者。");

    expect(report.passed).toBe(false);
    expect(report.blockingIssues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "CHARACTER_PROHIBITED_ACTION",
      "CHARACTER_FORBIDDEN_EXPRESSION",
      "LOCKED_TERM_ALIAS",
      "IMMUTABLE_WORLD_RULE_CONFLICT",
      "FORCED_FORESHADOWING_MISSED"
    ]));
  });

  it("正文提供回收证据且使用规范专名时通过", () => {
    const report = audit("林夕握紧月钥，在地牢中发现姐姐被王城囚禁的证据。她拒绝伤害守门的无辜者。");

    expect(report.passed).toBe(true);
    expect(report.blockingIssues).toEqual([]);
  });

  it("禁止行为出现在无关角色句段时不误判到目标角色", () => {
    const report = audit("守卫决定背叛姐姐。林夕握紧月钥，找到了姐姐被王城囚禁的证据。");

    expect(report.blockingIssues.some((issue) => issue.code === "CHARACTER_PROHIBITED_ACTION")).toBe(false);
  });
});

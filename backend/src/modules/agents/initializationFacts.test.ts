/**
 * 初始化事实层校验单元测试。
 * 覆盖：事件引用完整性（ke-/st- 悬空引用、投放晚于回收）、数字/时态忠实度
 * （同一人物同一锚词跨来源矛盾）、骨架事实卡 id 保留、补充实体/物品/初始状态事实卡抽取。
 */
import { describe, expect, it } from "vitest";
import type { InitializationBundle } from "./bookInitializationService.js";
import {
  collectEventReferenceIssues,
  collectForeshadowingScopeIssues,
  collectNumberDriftIssues,
  extractBackboneFacts,
  extractItemFacts,
  extractStateFacts,
  extractSupportingFacts,
  verifyOutlineStateConsistency
} from "./initializationFacts.js";

/** 构造一份最小可用的 InitializationBundle 夹具（只填充校验函数用到的字段）。 */
function createBundleFixture(): InitializationBundle {
  // 未用到的分区以 never 占位：never 可赋值给任意类型，保证对象字面量可通过类型检查，
  // 测试里只读写实际用到的字段（骨架事件、卷纲、状态、实体等）。
  return {
    foundation: {} as never,
    world: { regions: [] } as never,
    storyGraph: {
      characters: [
        { id: "su-jian", name: "苏见", role: "主要", identity: "", goal: "", motivation: "", weakness: "", arc: "", factionIds: [] },
        { id: "lin-wanqing", name: "林晚晴", role: "次要", identity: "", goal: "", motivation: "", weakness: "", arc: "", factionIds: [] }
      ],
      factions: [],
      relationships: []
    } as never,
    backbone: {
      startEvents: [
        { id: "st-1", title: "苏见觉醒观测能力", detail: "清晨苏见看见女孩头顶的系统面板", relatedEntityIds: [], status: "happened" }
      ],
      keyEvents: [
        { id: "ke-2-1", title: "林晚晴连签抉择", detail: "苏见说服林晚晴为陪护受伤好友中断一次签到", volumeIndex: 2, relatedEntityIds: [] }
      ],
      timelineNote: ""
    } as never,
    outline: {
      mainLine: "",
      estimatedChapters: 1,
      volumes: [],
      requiredEntities: { locations: [], supportingCharacters: [], items: [] }
    } as never,
    supporting: { locations: [], supportingCharacters: [] } as never,
    items: { items: [] } as never,
    state: {
      storyStart: "",
      publicFacts: [],
      secrets: [],
      nextGoals: [],
      characterStates: [],
      factionStates: [],
      itemStates: [],
      foreshadowing: []
    } as never
  } as InitializationBundle;
}

describe("collectEventReferenceIssues", () => {
  it("检出伏笔文本中悬空的 ke-/st- 事件引用", () => {
    const bundle = createBundleFixture();
    bundle.state.foreshadowing = [{
      id: "lin-wanqing-test",
      content: "林晚晴在真实友谊与签到奖励之间抉择",
      relatedEntityIds: ["lin-wanqing"],
      placement: "通过 ke-2-1 林晚晴为陪护陆瑶中断签到",
      resolution: "通过 ke-9-9 回收（该事件不存在）",
      status: "planned"
    }];

    const issues = collectEventReferenceIssues(bundle);

    expect(issues.some((issue) => issue.includes("ke-9-9"))).toBe(true);
    expect(issues.some((issue) => issue.includes("ke-2-1"))).toBe(false);
  });

  it("检出投放卷号晚于回收卷号的时间顺序错误", () => {
    const bundle = createBundleFixture();
    bundle.state.foreshadowing = [{
      id: "order-broken",
      content: "某伏笔",
      relatedEntityIds: [],
      placement: "第三卷 ke-3-1 投放",
      resolution: "第一卷回收",
      status: "planned"
    }];

    const issues = collectEventReferenceIssues(bundle);

    expect(issues.some((issue) => issue.includes("晚于回收"))).toBe(true);
  });

  it("放投放早于回收时不报错", () => {
    const bundle = createBundleFixture();
    bundle.state.foreshadowing = [{
      id: "order-ok",
      content: "某伏笔",
      relatedEntityIds: [],
      placement: "第一卷投放",
      resolution: "第二卷 ke-2-1 回收",
      status: "planned"
    }];

    expect(collectEventReferenceIssues(bundle)).toHaveLength(0);
  });
});

describe("collectNumberDriftIssues", () => {
  it("检出同一人物同一锚词的数值矛盾", () => {
    const bundle = createBundleFixture();
    // 骨架事实说 200 天，卷纲却说 180 天
    bundle.backbone.startEvents[0].detail = "林晚晴的签到系统已连续打卡 200 天";
    bundle.outline.volumes = [{
      title: "测试卷",
      goal: "林晚晴的签到系统已连续打卡 180 天",
      conflict: "",
      turningPoint: "",
      climax: "",
      resolution: "",
      characterChanges: []
    }];

    const issues = collectNumberDriftIssues(bundle);

    expect(issues.some((issue) => issue.includes("林晚晴") && issue.includes("180"))).toBe(true);
  });

  it("检出同一人物同一锚词的时态互斥（已达 vs 即将达到）", () => {
    const bundle = createBundleFixture();
    bundle.backbone.startEvents[0].detail = "林晚晴的签到系统已连续打卡 200 天";
    bundle.state.nextGoals = ["留意林晚晴连续签到即将达到 200 天"];

    const issues = collectNumberDriftIssues(bundle);

    expect(issues.some((issue) => issue.includes("时态矛盾"))).toBe(true);
  });

  it("数字与时态完全一致时不误报", () => {
    const bundle = createBundleFixture();
    bundle.backbone.startEvents[0].detail = "林晚晴的签到系统已连续打卡 200 天";
    bundle.state.characterStates = [{ characterId: "lin-wanqing", state: "林晚晴的签到系统已连续打卡 200 天" }];

    expect(collectNumberDriftIssues(bundle)).toHaveLength(0);
  });

  it("无主语的泛指数字（如街边陌生女生打卡 37 天）不误报", () => {
    const bundle = createBundleFixture();
    bundle.state.storyStart = "前方女生的头顶浮现【签到任务 · 连续打卡第 37 天】";

    expect(collectNumberDriftIssues(bundle)).toHaveLength(0);
  });
});

describe("伏笔池长线覆盖（卷纲已取消伏笔计划，伏笔池为唯一长线体系）", () => {
  /** 构造 N 卷的卷纲夹具。 */
  function volumesFixture(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      title: `第${index + 1}卷标题`,
      goal: "",
      conflict: "",
      turningPoint: "",
      climax: "",
      resolution: "",
      characterChanges: []
    }));
  }

  it("伏笔池条目与卷纲人物变化重复判定为互斥", () => {
    const bundle = createBundleFixture();
    bundle.outline.volumes = volumesFixture(1);
    bundle.outline.volumes[0].characterChanges = ["林夕接受向他人求助"];
    bundle.state.foreshadowing = [{ id: "memory-price", content: "林夕接受向他人求助", relatedEntityIds: [], placement: "", resolution: "", status: "planned" }];

    expect(() => verifyOutlineStateConsistency(bundle.outline, bundle.state)).toThrow(/人物变化/);
  });

  it("伏笔池覆盖到结局卷时不报告缺口", () => {
    const bundle = createBundleFixture();
    bundle.outline.volumes = volumesFixture(3);
    bundle.state.foreshadowing = [
      { id: "f-1", content: "开场伏笔", relatedEntityIds: [], placement: "第一卷投放", resolution: "第三卷回收", status: "planted" },
      { id: "f-2", content: "结局伏笔", relatedEntityIds: [], placement: "第二卷投放", resolution: "第三卷 ke-3-1 回收", status: "planned" }
    ];

    expect(collectForeshadowingScopeIssues(bundle)).toHaveLength(0);
  });

  it("伏笔池未延伸到结局卷时报告缺口", () => {
    const bundle = createBundleFixture();
    bundle.outline.volumes = volumesFixture(5);
    bundle.state.foreshadowing = [
      { id: "f-1", content: "开场伏笔", relatedEntityIds: [], placement: "第一卷投放", resolution: "第二卷回收", status: "planted" }
    ];

    const issues = collectForeshadowingScopeIssues(bundle);

    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toContain("长线伏笔");
  });

  it("伏笔投放/回收计划完全没有卷号标注时报告缺口", () => {
    const bundle = createBundleFixture();
    bundle.outline.volumes = volumesFixture(2);
    bundle.state.foreshadowing = [
      { id: "f-1", content: "无卷号伏笔", relatedEntityIds: [], placement: "故事开篇埋下", resolution: "结局揭示", status: "planned" }
    ];

    expect(collectForeshadowingScopeIssues(bundle).length).toBeGreaterThan(0);
  });
});

describe("事实卡抽取与 id 保留", () => {
  it("extractBackboneFacts 保留骨架事件原始 id", () => {
    const bundle = createBundleFixture();
    const cards = extractBackboneFacts(bundle.backbone);

    expect(cards.map((card) => card.id)).toEqual(["fact:backbone-st-1", "fact:backbone-ke-2-1"]);
    expect(cards[0].content).toContain("开场已发生");
    expect(cards[1].content).toContain("第 2 卷");
  });

  it("extractSupportingFacts / extractItemFacts / extractStateFacts 输出实体与状态卡", () => {
    const bundle = createBundleFixture();
    bundle.supporting = {
      schemaVersion: "book-supporting-entities.v1",
      locations: [{ id: "old-bookstore", name: "潮汐旧书店", role: "身世线索场所", description: "老城区尽头的旧书店", regionId: "old-tide-district", controllerFactionId: null, rules: [], firstUse: "第 5 卷" }],
      supportingCharacters: []
    };
    bundle.items = { schemaVersion: "book-items.v1", items: [{ id: "legacy-object", name: "泛黄旧手册", role: "关键物证", description: "封面印有系统符号", ownerEntityId: null, locationId: "old-bookstore", abilities: [], limitations: [], firstUse: "第 5 卷", resolution: "终卷" }] };
    bundle.state.characterStates = [{ characterId: "lin-wanqing", state: "已连续打卡 200 天" }];

    const supportingCards = extractSupportingFacts(bundle.supporting);
    const itemCards = extractItemFacts(bundle.items);
    const stateCards = extractStateFacts(bundle.state);

    expect(supportingCards.map((card) => card.id)).toEqual(["fact:entity-old-bookstore"]);
    expect(supportingCards[0].kind).toBe("entity");
    expect(itemCards.map((card) => card.id)).toEqual(["fact:entity-legacy-object"]);
    expect(stateCards.map((card) => card.id)).toEqual(["fact:state-lin-wanqing"]);
    expect(stateCards[0].content).toContain("200 天");
  });
});

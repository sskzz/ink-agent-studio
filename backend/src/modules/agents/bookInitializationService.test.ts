import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RunCommand } from "@ink-agent/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelGenerateTextResult } from "../ai/types.js";
import type { ModelConfigRecord } from "../../types/domain.js";
import { createBook } from "../books/bookService.js";
import { getBook } from "../books/bookRepository.js";
import { listEntities } from "../books/entityService.js";
import { getBookFileContent } from "../files/fileService.js";
import { createWorkspacePaths } from "../workspace/workspacePaths.js";
import { ensureWorkspace } from "../workspace/workspaceService.js";
import { writeJsonFile } from "../../utils/jsonStore.js";
import { initializeBookWithAi } from "./bookInitializationService.js";
import type { RunExecutionContext } from "./runCoordinator.js";
import { readFactCards } from "../books/factRepository.js";

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

describe("initializeBookWithAi", () => {
  it("generates validated stages in dependency order and applies the complete bundle without overwriting user facts", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-book-initialization-"));
    const paths = createWorkspacePaths(tempRoot);
    await ensureWorkspace(paths);
    await writeJsonFile(paths.writingStylesFile, [{
      id: "style-ready",
      name: "紧凑悬疑",
      summary: "短句推进、信息递进",
      parameters: {},
      sampleFileName: null,
      latestVersionId: "style-version-1",
      sampleCount: 1,
      validSampleCount: 1,
      status: "ready",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }]);
    const created = await createBook(paths, {
      title: "用户锁定标题",
      brief: "用户不可覆盖简述：主角必须救回失踪的姐姐。",
      worldFileName: "user-world.md",
      worldFileContent: "# 用户世界观\n\nSECRET_WORLD_FACT：月亮永远不会落下。"
    });

    const stages: string[] = [];
    const artifacts: string[] = [];
    const checkpoints: string[] = [];
    const prompts: string[] = [];
    const systemPrompts: string[] = [];
    const purposes: string[] = [];
    const streams: Array<boolean | undefined> = [];
    let committed = false;
    const responses = createStageResponses();
    const command: Extract<RunCommand, { type: "initialize_book" }> = {
      schemaVersion: "run-command.v1",
      type: "initialize_book",
      bookId: created.id,
      input: { trigger: "test" }
    };
    const context: RunExecutionContext = {
      runId: "run-initialization-test",
      command,
      signal: new AbortController().signal,
      setStage(stage) {
        stages.push(stage);
      },
      emitProgress() {},
      emitDelta() {},
      saveArtifact(artifactType) {
        artifacts.push(artifactType);
        return { id: `artifact-${artifacts.length}`, contentHash: `hash-${artifacts.length}` };
      },
      loadArtifact() {
        return null;
      },
      saveCheckpoint(stage) {
        checkpoints.push(stage);
        return { id: `checkpoint-${checkpoints.length}` };
      },
      markCommitted() {
        committed = true;
      }
    };

    const result = await initializeBookWithAi(paths, context, {
      planningModel: fakeModel,
      reviewModel: fakeModel,
      async generateText(_paths, _model, input, purpose): Promise<ModelGenerateTextResult> {
        prompts.push(input.userPrompt);
        systemPrompts.push(input.systemPrompt);
        purposes.push(purpose);
        streams.push(input.stream);
        const response = responses.shift();
        if (!response) throw new Error("假模型缺少阶段响应");
        return { text: JSON.stringify(response), provider: "openai", model: "fake-model" };
      }
    });

    expect(responses).toHaveLength(0);
    expect(stages).toEqual([
      "foundation",
      "world",
      "story_graph",
      "story_backbone",
      "outline_plan",
      "entity_requirements",
      "outline",
      "supporting_entities",
      "items",
      "initial_state",
      "consistency_review",
      "apply_bundle"
    ]);
    expect(checkpoints).toEqual(stages);
    expect(artifacts).toHaveLength(12);
    expect(committed).toBe(true);
    expect(systemPrompts[0]).toContain('"const": "book-foundation.v1"');
    expect(systemPrompts[0]).toContain('"minimum": 20000');
    expect(systemPrompts[0]).toContain('"plannedWords"');
    expect(purposes).toEqual([
      "planning",
      "planning",
      "planning",
      "planning",
      "planning",
      "planning",
      "planning",
      "planning",
      "planning",
      "review"
    ]);
    expect(streams).toEqual(Array(10).fill(true));
    expect(prompts[1]).toContain("失踪姐姐引出的永夜阴谋");
    expect(prompts[2]).toContain("moon-coast");
    expect(prompts[3]).toContain("hero-lin");
    expect(prompts[6]).toContain("old-tower");
    expect(prompts[6]).toContain("guide-su");
    expect(prompts[7]).toContain("moon-key");
    expect(prompts[9]).toContain("月亮永远不会落下");

    const book = await getBook(paths, created.id);
    expect(book).toMatchObject({
      title: "用户锁定标题",
      genre: "悬疑奇幻",
      status: "drafting",
      writingStyleId: "style-ready",
      writingStyleVersionId: "style-version-1"
    });
    expect(book.needsAiFill).toEqual([]);

    const files = await Promise.all([
      "brief",
      "outline",
      "world",
      "current-state",
      "foreshadowing"
    ].map((fileId) => getBookFileContent(paths, created.id, fileId)));
    expect(files.every((file) => file.content.trim().length > 80)).toBe(true);
    expect(files[0].content).toContain("用户不可覆盖简述：主角必须救回失踪的姐姐。");
    expect(files[2].content).toContain("SECRET_WORLD_FACT：月亮永远不会落下。");

    const entities = await listEntities(paths, created.id);
    expect(new Set(entities.map((entity) => entity.entityType))).toEqual(
      new Set(["character", "faction", "location", "item"])
    );
    expect(entities.map((entity) => entity.id)).toEqual(expect.arrayContaining([
      "hero-lin",
      "rival-qin",
      "guide-su",
      "night-watch",
      "old-tower",
      "moon-key"
    ]));
    expect(result).toMatchObject({ approvalRequired: false, generatedEntities: 6 });
  });

  it("injects immutable facts and confirmed summary into downstream stage prompts and normalizes locked book fields", async () => {
    const { prompts } = await runInitializationWithResponses(createStageResponses());

    expect(prompts[1]).toContain("用户锁定标题");
    expect(prompts[1]).not.toContain("AI 不应覆盖的标题");
    expect(prompts[2]).toContain("【不可变事实");
    expect(prompts[2]).toContain("[fact:foundation-premise]");
    expect(prompts[2]).toContain("[fact:world-rule-1]");
    expect(prompts[2]).toContain("【已确认设定摘要");
    expect(prompts[2]).toContain("[fact:region-moon-coast]");
    expect(prompts[4]).toContain("[fact:backbone-start-1]");
    expect(prompts[4]).toContain("[fact:backbone-key-1]");
    expect(prompts[6]).toContain("【不可变事实");
  });

  it("rejects when initial state duplicates an event already planned in the outline", async () => {
    const responses = createStageResponses();
    const initialState = responses[8] as { foreshadowing: Array<{ content: string }> };
    initialState.foreshadowing[0].content = "月钥能开启旧塔核心";

    await expect(runInitializationWithResponses(responses)).rejects.toThrow(/事件重复/);
  });

  it("rejects when the outline replans an event already fixed in the story backbone", async () => {
    const responses = createStageResponses();
    const outlinePlan = responses[4] as { volumes: Array<{ foreshadowing: string[] }> };
    outlinePlan.volumes[0].foreshadowing = ["姐姐失踪"];

    await expect(runInitializationWithResponses(responses)).rejects.toThrow(/时间线骨架重复/);
  });

  it("repairs a failing consistency review by regenerating downstream stages with injected issues", async () => {
    const base = createStageResponses();
    const responses = [
      ...base.slice(0, 9),
      {
        schemaVersion: "book-initialization-review.v1",
        passed: false,
        issues: [{ severity: "blocking", message: "卷纲与时间线骨架冲突：激活事件重复" }],
        summary: "存在阻断冲突"
      },
      ...base.slice(3, 9),
      base[9]
    ];
    const { prompts } = await runInitializationWithResponses(responses);

    expect(prompts).toHaveLength(17);
    expect(prompts[16]).toContain("【上一轮一致性审查未通过的问题");
    expect(prompts[16]).toContain("卷纲与时间线骨架冲突");
  });

  it("rejects when an entity requirement schedules an event already fixed in the story backbone", async () => {
    const responses = createStageResponses();
    const requirements = responses[5] as {
      requiredEntities: { supportingCharacters: Array<{ firstUse: string }> };
    };
    requirements.requiredEntities.supportingCharacters[0].firstUse = "姐姐失踪";

    await expect(runInitializationWithResponses(responses)).rejects.toThrow(/firstUse 与时间线骨架/);
  });

  it("persists fact cards into the book directory after a successful initialization", async () => {
    const { paths, bookId } = await runInitializationWithResponses(createStageResponses());

    const facts = await readFactCards(paths, bookId);
    const byId = new Map(facts.map((card) => [card.id, card]));
    expect(byId.get("fact:foundation-premise")?.content).toContain("永夜阴谋");
    expect(byId.get("fact:world-rule-1")?.content).toContain("月潮");
    expect(byId.get("fact:world-rule-1")?.mutability).toBe("immutable");
    expect(byId.get("fact:foundation-boundary-1")?.kind).toBe("rule");
    expect(byId.get("fact:backbone-start-1")?.content).toContain("姐姐失踪");
    expect(byId.get("fact:summary-mainline")?.content).toContain("林夕追查姐姐失踪");
    expect(byId.get("fact:summary-story-start")?.content).toContain("空白档案");
    expect(byId.get("fact:summary-timeline")?.content).toContain("既成事实");
    expect(facts.every((card) => card.schemaVersion === "fact-card.v1")).toBe(true);
  });
});

async function runInitializationWithResponses(responses: unknown[]) {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-book-initialization-"));
  const paths = createWorkspacePaths(tempRoot);
  await ensureWorkspace(paths);
  await writeJsonFile(paths.writingStylesFile, [{
    id: "style-ready",
    name: "紧凑悬疑",
    summary: "短句推进、信息递进",
    parameters: {},
    sampleFileName: null,
    latestVersionId: "style-version-1",
    sampleCount: 1,
    validSampleCount: 1,
    status: "ready",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  }]);
  const created = await createBook(paths, {
    title: "用户锁定标题",
    brief: "用户不可覆盖简述：主角必须救回失踪的姐姐。",
    worldFileName: "user-world.md",
    worldFileContent: "# 用户世界观\n\nSECRET_WORLD_FACT：月亮永远不会落下。"
  });
  const command: Extract<RunCommand, { type: "initialize_book" }> = {
    schemaVersion: "run-command.v1",
    type: "initialize_book",
    bookId: created.id,
    input: { trigger: "test" }
  };
  const context: RunExecutionContext = {
    runId: `run-${responses.length}`,
    command,
    signal: new AbortController().signal,
    setStage() {},
    emitProgress() {},
    emitDelta() {},
    saveArtifact(artifactType) {
      return { id: `artifact-${artifactType}`, contentHash: "hash" };
    },
    loadArtifact() {
      return null;
    },
    saveCheckpoint(stage) {
      return { id: `checkpoint-${stage}` };
    },
    markCommitted() {}
  };
  const prompts: string[] = [];
  await initializeBookWithAi(paths, context, {
    planningModel: fakeModel,
    reviewModel: fakeModel,
    async generateText(_paths, _model, input): Promise<ModelGenerateTextResult> {
      prompts.push(input.userPrompt);
      const response = responses.shift();
      if (!response) throw new Error("假模型缺少阶段响应");
      return { text: JSON.stringify(response), provider: "openai", model: "fake-model" };
    }
  });
  return { paths, bookId: created.id, prompts };
}

const fakeModel: ModelConfigRecord = {
  id: "fake-model",
  name: "Fake model",
  provider: "openai",
  baseUrl: "http://127.0.0.1",
  apiModel: "fake-model",
  purpose: "planning",
  enabled: true,
  isDefault: true,
  capabilities: {},
  note: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

function createStageResponses(): unknown[] {
  return [
    {
      schemaVersion: "book-foundation.v1",
      book: {
        title: "AI 不应覆盖的标题",
        genre: "悬疑奇幻",
        narrationPerspective: "第三人称限知",
        channel: "女频",
        protagonistGender: "女",
        protagonistName: "林夕",
        plannedWords: 200000,
        chapterWords: 2500,
        writingStyleId: "style-ready"
      },
      premise: "失踪姐姐引出的永夜阴谋",
      themes: ["选择与代价"],
      coreConflict: "林夕必须在守夜人与旧王庭之间找到真相",
      protagonistGoal: "救回姐姐并终结永夜",
      stakes: "失败会让整座月海城失去时间",
      sellingPoints: ["永不落下的月亮", "双线谜案"],
      readerPromises: ["每卷揭开一层真相"],
      boundaries: ["不改变月亮永不落下的设定"]
    },
    {
      schemaVersion: "book-world.v1",
      overview: "月海城被永恒月光笼罩",
      era: "旧王庭覆灭后的第十七年",
      society: "守夜人管理城市，行会控制物资",
      rules: [
        { name: "月潮", description: "月光会周期性实体化", limitation: "只能持续一刻钟", cost: "使用者失去记忆" },
        { name: "影渡", description: "影子可连接相邻街区", limitation: "不能跨越流水", cost: "留下可追踪痕迹" }
      ],
      powerSystems: [{ name: "刻月术", description: "借月纹改变局部规则", limitation: "每次必须支付记忆" }],
      history: ["旧王庭试图让月亮停驻，随后一夜覆灭"],
      regions: [
        { id: "moon-coast", name: "月海岸", summary: "月潮最强的港区" },
        { id: "inner-ring", name: "内环城", summary: "守夜人总部所在" }
      ],
      conflictSources: ["守夜人隐瞒停月真相"]
    },
    {
      schemaVersion: "book-story-graph.v1",
      characters: [
        { id: "hero-lin", name: "林夕", role: "主要", identity: "档案修复师", goal: "救回姐姐", motivation: "守住家人", weakness: "不愿求助", arc: "学会承担共同选择", factionIds: ["night-watch"] },
        { id: "rival-qin", name: "秦昼", role: "主要", identity: "守夜人审判官", goal: "维持停月秩序", motivation: "避免城市崩溃", weakness: "迷信秩序", arc: "承认真相不能永远封存", factionIds: ["night-watch"] }
      ],
      factions: [
        { id: "night-watch", name: "守夜人", role: "城市秩序核心", goal: "维持永月结界", resources: ["月纹档案"], limitations: ["不能公开旧王庭真相"], internalConflict: "改革派与保守派对立" }
      ],
      relationships: [
        { fromId: "hero-lin", toId: "rival-qin", relation: "调查者与阻拦者", tension: "二人都想救城但路径相反" }
      ]
    },
    {
      schemaVersion: "book-story-backbone.v1",
      startEvents: [
        { id: "sister-missing", title: "姐姐失踪", detail: "故事开始时姐姐已失踪，林夕收到空白档案", relatedEntityIds: ["hero-lin"], status: "happened" },
        { id: "moon-curse", title: "月亮不再落下", detail: "永夜结界在十七年前已经启动", relatedEntityIds: ["night-watch"], status: "ongoing" }
      ],
      keyEvents: [
        { id: "key-old-tower", title: "进入旧塔", detail: "林夕与秦昼进入旧塔核心", volumeIndex: 1, relatedEntityIds: ["hero-lin", "rival-qin"] }
      ],
      timelineNote: "开场事件均为既成事实，后续阶段只能引用"
    },
    {
      schemaVersion: "book-outline-plan.v1",
      mainLine: "林夕追查姐姐失踪并逐步发现永月结界的代价",
      estimatedChapters: 80,
      volumes: [{
        title: "月海失踪案",
        goal: "找到姐姐留下的月钥线索",
        conflict: "守夜人封锁旧塔",
        turningPoint: "秦昼发现档案被篡改",
        climax: "林夕进入月潮中心",
        resolution: "二人暂时合作",
        characterChanges: ["林夕接受向他人求助"],
        foreshadowing: ["月钥能开启旧塔核心"]
      }]
    },
    {
      schemaVersion: "book-entity-requirements.v1",
      requiredEntities: {
        locations: [{ id: "old-tower", nameHint: "旧塔", purpose: "第一卷调查核心地点", firstUse: "第一章远眺，第三章进入" }],
        supportingCharacters: [{ id: "guide-su", nameHint: "苏引", purpose: "提供月潮航路", firstUse: "第二章" }],
        items: [{ id: "moon-key", nameHint: "月钥", purpose: "开启旧塔核心", firstUse: "第四章发现" }]
      }
    },
    {
      schemaVersion: "book-supporting-entities.v1",
      locations: [{ id: "old-tower", name: "旧塔", role: "调查核心地点", description: "旧王庭遗留的观月塔", regionId: "moon-coast", controllerFactionId: "night-watch", rules: ["月潮时入口显现"], firstUse: "第一章远眺，第三章进入" }],
      supportingCharacters: [{ id: "guide-su", name: "苏引", role: "次要", identity: "月潮向导", goal: "偿还旧债", motivation: "保护港区", weakness: "隐瞒关键航线", arc: "最终公开航线", factionIds: ["night-watch"] }]
    },
    {
      schemaVersion: "book-items.v1",
      items: [{ id: "moon-key", name: "月钥", role: "开启旧塔核心", description: "姐姐留下的银色钥匙", ownerEntityId: "hero-lin", locationId: "old-tower", abilities: ["读取月纹"], limitations: ["每次使用会抹去一段记忆"], firstUse: "第四章发现", resolution: "终卷用于关闭永月核心" }]
    },
    {
      schemaVersion: "book-initial-state.v1",
      storyStart: "林夕收到姐姐失踪前寄出的空白档案",
      publicFacts: ["月亮永远不会落下"],
      secrets: ["永月结界以居民记忆为燃料"],
      nextGoals: ["确认空白档案中的隐形月纹"],
      characterStates: [{ characterId: "hero-lin", state: "尚不知道姐姐进入旧塔" }],
      factionStates: [{ factionId: "night-watch", state: "正在回收失窃档案" }],
      itemStates: [{ itemId: "moon-key", state: "藏在空白档案夹层" }],
      foreshadowing: [{ id: "memory-price", content: "林夕忘记童年歌谣的一句", relatedEntityIds: ["hero-lin", "moon-key"], placement: "第五章首次使用月钥后", resolution: "终卷揭示记忆代价", status: "planned" }]
    },
    {
      schemaVersion: "book-initialization-review.v1",
      passed: true,
      issues: [],
      summary: "实体引用、锁定事实和时间顺序均一致"
    }
  ];
}

/**
 * 章节细纲规划器单测：schema 校验、模型输出解析、JSON 修复、强制失败与渲染。
 */
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelConfigRecord } from "../../types/domain.js";
import { writeJsonFile } from "../../utils/jsonStore.js";
import { createWorkspacePaths, type WorkspacePaths } from "../workspace/workspacePaths.js";
import { ensureWorkspace } from "../workspace/workspaceService.js";
import { chapterOutlineSchema, planChapterOutline, renderChapterOutline, type ChapterOutline } from "./chapterOutlinePlanner.js";
import type { RuntimeState } from "../../schemas/runtimeStateSchemas.js";
import type { BookGenerationMetadata } from "./bookGenerationMetadata.js";

let tempRoot: string | null = null;
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

async function createFixture() {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-outline-planner-"));
  const paths = createWorkspacePaths(tempRoot);
  await ensureWorkspace(paths);
  return paths;
}

function ok(content: string) {
  return JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } });
}

async function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("测试服务器监听失败");
  return `http://127.0.0.1:${address.port}`;
}

function model(id: string, baseUrl: string): ModelConfigRecord {
  return {
    id,
    name: id,
    provider: "openai-compatible",
    baseUrl,
    apiModel: `${id}-api`,
    purpose: "writing",
    enabled: true,
    isDefault: false,
    capabilities: {},
    thinking: null,
    note: "",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
}

const validOutline = {
  schemaVersion: "chapter-outline.v1",
  summary: "苏见与陈栀的首次系统面板冲突",
  scenes: [
    {
      sceneType: "dialogue" as const,
      goal: "苏见发现陈栀面板异常",
      conflict: "陈栀不愿承认自己状态异常",
      events: ["苏见进入教室", "看到陈栀头顶面板闪烁", "决定观察"],
      actionBeat: "陈栀把模拟卷压到书本下面",
      dialogueGoal: "苏见试探陈栀是否需要帮助",
      subtext: "双方都不愿暴露自己的秘密",
      characterReaction: "陈栀捏住卷角并移开视线",
      sensoryAnchor: "卷角摩擦桌面的干涩声",
      turn: "陈栀反问苏见为何一直盯着她",
      progression: "苏见确认面板异常与自身能力相关"
    }
  ],
  progression: { from: "苏见刚觉醒观测能力", to: "苏见确认陈栀面板隐藏注记" },
  foreshadowing: [
    { item: "hook-chen", action: "advance", note: "推进陈栀隐藏注记伏笔" },
    { action: "plant", note: "植入苏见能力的副作用暗示" }
  ]
};

const bookMetadata: BookGenerationMetadata = {
  schemaVersion: "book-generation-metadata.v1",
  bookId: "book-1",
  title: "测试书",
  genre: "轻小说",
  channel: "男频",
  narrationPerspective: "第三人称",
  protagonist: { name: "苏见", gender: "男" },
  plannedWords: 500000,
  chapterWords: 3500,
  writingStyle: { id: "style-1", versionId: "version-1" },
  foundation: { premise: "苏见能看见系统面板", coreConflict: "能力只读", protagonistGoal: "帮助同伴", stakes: "误判会伤害同伴", boundaries: ["不能替人物做选择"], readerPromises: [] },
  unresolvedFields: []
};

const runtimeState: RuntimeState = {
  schemaVersion: "book-runtime-state.v1",
  baseline: {
    storyStart: "起点",
    publicFacts: [],
    secrets: [],
    nextGoals: ["接近陈栀"],
    characterStates: [],
    factionStates: [],
    itemStates: [],
    foreshadowing: [
      { id: "hook-chen", content: "陈栀的隐藏注记", relatedEntityIds: [], placement: "第一卷", resolution: "第二卷", status: "planted", lastAdvancedChapter: 1 },
      { id: "hook-resolved", content: "已回收伏笔", relatedEntityIds: [], placement: "第一卷", resolution: "第一卷", status: "resolved", lastAdvancedChapter: 1 },
      { id: "hook-clean", content: "干净伏笔", relatedEntityIds: [], placement: "第一卷", resolution: "第三卷", status: "planned", lastAdvancedChapter: null }
    ]
  },
  deltas: [],
  history: [],
  state: {
    storyStart: "起点",
    publicFacts: [],
    secrets: [],
    nextGoals: ["接近陈栀"],
    characterStates: [],
    factionStates: [],
    itemStates: [],
    foreshadowing: [
      { id: "hook-chen", content: "陈栀的隐藏注记", relatedEntityIds: [], placement: "第一卷", resolution: "第二卷", status: "planted", lastAdvancedChapter: 1 },
      { id: "hook-resolved", content: "已回收伏笔", relatedEntityIds: [], placement: "第一卷", resolution: "第一卷", status: "resolved", lastAdvancedChapter: 1 },
      { id: "hook-clean", content: "干净伏笔", relatedEntityIds: [], placement: "第一卷", resolution: "第三卷", status: "planned", lastAdvancedChapter: null }
    ]
  },
  chapterSummaries: {}
};

describe("chapterOutlineSchema", () => {
  it("接受合法的 chapter-outline.v1 载荷", () => {
    expect(() => chapterOutlineSchema.parse(validOutline)).not.toThrow();
  });

  it("拒绝缺少场景或字段的载荷", () => {
    expect(() => chapterOutlineSchema.parse({ ...validOutline, scenes: [] })).toThrow();
    expect(() => chapterOutlineSchema.parse({ ...validOutline, progression: {} })).toThrow();
  });
});

describe("renderChapterOutline", () => {
  it("渲染包含要点、推进与伏笔动作的细纲文本", () => {
    const plan: ChapterOutline = {
      summary: validOutline.summary,
      scenes: validOutline.scenes,
      progression: validOutline.progression,
      foreshadowing: [
        { item: "hook-chen", action: "advance", note: "推进注记" },
        { item: null, action: "plant", note: "植入副作用" }
      ]
    };
    const text = renderChapterOutline(plan);
    expect(text).toContain("苏见与陈栀的首次系统面板冲突");
    expect(text).toContain("从「苏见刚觉醒观测能力」推进至「苏见确认陈栀面板隐藏注记」");
    expect(text).toContain("[advance]（伏笔池 hook-chen）");
    expect(text).toContain("[plant]（新伏笔）");
    expect(text).toContain("对话目标：苏见试探陈栀是否需要帮助");
    expect(text).toContain("人物反应：陈栀捏住卷角并移开视线");
    expect(text).toContain("感官锚点：卷角摩擦桌面的干涩声");
  });
});

describe("planChapterOutline", () => {
  it("无写作模型路由时拒绝继续生成正文", async () => {
    const paths = await createFixture();
    await expect(planChapterOutline(paths, {
      chapterTitle: "第一章",
      chapterOutline: "",
      instruction: "继续",
      currentFocus: "",
      runtimeState
    })).rejects.toThrow("无法生成章节细纲");
  });

  it("模型返回合法细纲时解析并归一化输出", async () => {
    const paths = await createFixture();
    let receivedUserPrompt = "";
    const url = await listen((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        try { receivedUserPrompt = JSON.parse(body).messages.at(-1).content; } catch { /* ignore */ }
        response.setHeader("Content-Type", "application/json");
        response.end(ok(JSON.stringify(validOutline)));
      });
    });
    const writing = model("writing", url);
    await writeJsonFile(paths.modelConfigsFile, [writing]);
    await writeJsonFile(paths.modelRoutesFile, { writingModelId: writing.id, reviewModelId: null, planningModelId: null });

    const plan = await planChapterOutline(paths, {
      chapterTitle: "第一章",
      chapterOutline: "原有细纲",
      instruction: "继续",
      currentFocus: "当前关注点",
      runtimeState,
      bookMetadata
    });

    expect(plan.scenes).toHaveLength(1);
    expect(plan.scenes[0].events).toHaveLength(3);
    expect(plan.foreshadowing[0]).toEqual({ item: "hook-chen", action: "advance", note: "推进陈栀隐藏注记伏笔" });
    // item 缺省归一化为 null
    expect(plan.foreshadowing[1]).toEqual({ item: null, action: "plant", note: "植入苏见能力的副作用暗示" });
    // 伏笔池输入只列待推进条目：已回收的 hook-resolved 不进入 prompt
    expect(receivedUserPrompt).toContain("hook-chen");
    expect(receivedUserPrompt).toContain("hook-clean");
    expect(receivedUserPrompt).not.toContain("hook-resolved");
    expect(receivedUserPrompt).toContain("频道：男频");
    expect(receivedUserPrompt).toContain("主角：苏见（性别：男）");
  });

  it("模型与修复请求都返回非法内容时拒绝继续生成正文", async () => {
    const paths = await createFixture();
    const url = await listen((_request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(ok("这不是 JSON"));
    });
    const writing = model("writing", url);
    await writeJsonFile(paths.modelConfigsFile, [writing]);
    await writeJsonFile(paths.modelRoutesFile, { writingModelId: writing.id, reviewModelId: null, planningModelId: null });

    await expect(planChapterOutline(paths, {
      chapterTitle: "第一章",
      chapterOutline: "",
      instruction: "",
      currentFocus: "",
      runtimeState
    })).rejects.toThrow("修复后仍未通过校验");
  });

  it("首次输出非法时允许一次低温 JSON 修复", async () => {
    const paths = await createFixture();
    let requestCount = 0;
    const url = await listen((_request, response) => {
      requestCount += 1;
      response.setHeader("Content-Type", "application/json");
      response.end(ok(requestCount === 1 ? "非法输出" : JSON.stringify(validOutline)));
    });
    const writing = model("writing", url);
    await writeJsonFile(paths.modelConfigsFile, [writing]);
    await writeJsonFile(paths.modelRoutesFile, { writingModelId: writing.id, reviewModelId: null, planningModelId: null });

    const plan = await planChapterOutline(paths, {
      chapterTitle: "第一章",
      chapterOutline: "",
      instruction: "",
      currentFocus: "",
      runtimeState
    });

    expect(plan.summary).toBe(validOutline.summary);
    expect(requestCount).toBe(2);
  });
});

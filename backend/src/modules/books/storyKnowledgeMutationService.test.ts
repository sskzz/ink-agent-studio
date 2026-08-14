import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureWorkspace } from "../workspace/workspaceService.js";
import { createWorkspacePaths } from "../workspace/workspacePaths.js";
import { createBook } from "./bookService.js";
import { saveEntity } from "./entityService.js";
import {
  createBaselineRuntimeState,
  readRuntimeState,
  replaceChapterStateEvent,
  writeRuntimeState
} from "./runtimeStateRepository.js";
import { createInitialStoryPlan, createInitialWorldRuleRegistry, writeStoryPlan, writeWorldRuleRegistry } from "./storyKnowledgeRepository.js";
import {
  advanceForeshadowingStatus,
  archiveWorldRule,
  deleteLockedTerm,
  saveCharacterProfileValidated,
  updateStoryPlanVolume,
  upsertForeshadowing,
  upsertStoryPlanChapter
} from "./storyKnowledgeMutationService.js";

let root: string | null = null;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "ink-agent-knowledge-mutation-"));
  await ensureWorkspace(createWorkspacePaths(root));
});

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

async function setup() {
  const paths = createWorkspacePaths(root!);
  const book = await createBook(paths, { title: "知识变更测试" });
  for (const character of [
    { id: "hero-lin", name: "林夕" },
    { id: "ally-su", name: "苏见" }
  ]) {
    await saveEntity(paths, book.id, {
      id: character.id,
      entityType: "character",
      name: character.name,
      role: "角色",
      description: "测试角色",
      attributes: {}
    });
  }
  const plan = createInitialStoryPlan(book.id, {
    mainLine: "调查旧塔真相",
    estimatedChapters: 50,
    volumes: [{ title: "第一卷", goal: "进入旧塔", conflict: "守卫阻拦", turningPoint: "盟友失踪", climax: "打开塔门", resolution: "获得线索", characterChanges: [] }],
    terms: [{ id: "term-old-tower", term: "旧塔", category: "location" }]
  });
  await writeStoryPlan(paths, book.id, plan);
  await writeRuntimeState(paths, book.id, createBaselineRuntimeState({
    storyStart: "林夕抵达王城",
    publicFacts: [], secrets: [], nextGoals: [], characterStates: [], factionStates: [], itemStates: [],
    foreshadowing: [{
      id: "hook-moon", content: "月钥的代价", relatedEntityIds: ["hero-lin"], placement: "第 1 章", resolution: "第 10 章",
      horizon: "long", targetChapterRange: { start: 8, end: 10 }, status: "planned", lastAdvancedChapter: null
    }]
  }));
  return { paths, book, plan };
}

function chapter(chapterNo = 1) {
  return {
    chapterNo,
    volumeNo: 1,
    title: "进入旧塔",
    dimensions: {
      synopsis: "林夕进入旧塔并发现月钥留下的新线索",
      characterActions: [{ characterId: "hero-lin", action: "调查塔门" }],
      scenes: ["塔门", "地下室"], conflicts: ["守卫阻拦"], narrativeGoals: ["取得月钥线索"]
    },
    lockedTermIds: ["term-old-tower"], status: "approved" as const, reviewNotes: []
  };
}

describe("story knowledge mutation service", () => {
  it("专名被章纲引用时拒绝删除，并拒绝未知角色引用", async () => {
    const { paths, book } = await setup();
    await upsertStoryPlanChapter(paths, book.id, 1, chapter());
    await expect(deleteLockedTerm(paths, book.id, "term-old-tower")).rejects.toThrow("仍被章级细纲引用");
    await expect(upsertStoryPlanChapter(paths, book.id, 2, {
      ...chapter(2),
      dimensions: { ...chapter(2).dimensions, characterActions: [{ characterId: "missing-role", action: "出现" }] }
    })).rejects.toThrow("未知角色");
  });

  it("拒绝非法卷范围和人物关系/里程碑", async () => {
    const { paths, book, plan } = await setup();
    await expect(updateStoryPlanVolume(paths, book.id, 1, {
      ...plan.volumes[0], chapterRange: { start: 20, end: 10 }
    })).rejects.toThrow();
    const profile = {
      schemaVersion: "character-profile.v1" as const,
      core: { appearance: "", personalityTraits: [], motivations: [], values: [], hardConstraints: [], prohibitedActions: [] },
      arc: { startState: "", targetState: "", milestones: [{ chapterRange: { start: 12, end: 5 }, change: "错误范围" }] },
      timeline: { currentState: "", knownHistory: [] },
      relationships: [{ targetCharacterId: "hero-lin", relation: "自己", tension: "", allowedDirection: "" }],
      dialogueDna: { voice: "", sentenceRhythm: "", signaturePhrases: [], forbiddenExpressions: [], subtextHabits: [] }
    };
    await expect(saveCharacterProfileValidated(paths, book.id, "hero-lin", profile)).rejects.toThrow("人物关系不能指向自己");
    profile.relationships = [{ targetCharacterId: "missing-role", relation: "未知", tension: "", allowedDirection: "" }];
    await expect(saveCharacterProfileValidated(paths, book.id, "hero-lin", profile)).rejects.toThrow("人物关系目标不存在");
  });

  it("伏笔状态只能前进，baseline 编辑后重放仍保留章节推进", async () => {
    const { paths, book } = await setup();
    const initial = (await readRuntimeState(paths, book.id))!;
    const progressed = replaceChapterStateEvent(initial, {
      chapterId: "chapter-3", chapterNo: 3, chapterRevision: 1, observationRevision: 1, contentHash: "hash", recordedAt: new Date().toISOString(),
      delta: { schemaVersion: "book-state-delta.v1", foreshadowing: [{
        ...initial.state.foreshadowing[0], content: "旧描述副本", status: "advancing", lastAdvancedChapter: 3
      }] }
    });
    await writeRuntimeState(paths, book.id, progressed);
    await upsertForeshadowing(paths, book.id, { ...progressed.state.foreshadowing[0], content: "人工修订后的代价", status: "advancing" });
    const afterEdit = (await readRuntimeState(paths, book.id))!;
    expect(afterEdit.state.foreshadowing[0]).toMatchObject({ content: "人工修订后的代价", status: "advancing", lastAdvancedChapter: 3 });
    await expect(advanceForeshadowingStatus(paths, book.id, "hook-moon", "planted", 4)).rejects.toThrow("不能倒退");
    await expect(advanceForeshadowingStatus(paths, book.id, "hook-moon", "resolving", 8)).resolves.toMatchObject({ status: "resolving", lastAdvancedChapter: 8 });
  });

  it("归档世界规则后不再处于 active 集合", async () => {
    const { paths, book } = await setup();
    await writeWorldRuleRegistry(paths, book.id, createInitialWorldRuleRegistry(book.id, [
      { id: "moon-law", title: "月潮法则", content: "月潮只持续一刻钟", category: "law", mutability: "immutable" }
    ]));
    const registry = await archiveWorldRule(paths, book.id, "moon-law");
    expect(registry.rules.find((rule) => rule.id === "moon-law")?.status).toBe("archived");
    expect(registry.rules.filter((rule) => rule.status === "active")).toHaveLength(0);
  });
});

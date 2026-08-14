import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspacePaths } from "../workspace/workspacePaths.js";
import { ensureWorkspace } from "../workspace/workspaceService.js";
import { createBook } from "./bookService.js";
import { saveEntity } from "./entityService.js";
import { createInitialStoryPlan, writeStoryPlan } from "./storyKnowledgeRepository.js";
import { generateStoryPlanBatch } from "./storyPlanService.js";
import { saveModelConfig, setModelRoute } from "../models/modelConfigRepository.js";

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

describe("generateStoryPlanBatch", () => {
  it("保存候选、质量闸门和批准 Artifact，恢复时不重复调用模型", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-story-plan-run-"));
    const paths = createWorkspacePaths(tempRoot);
    await ensureWorkspace(paths);
    const book = await createBook(paths, { title: "长篇测试", protagonistName: "林夕" });
    const bookId = book.id;
    await saveEntity(paths, bookId, {
      id: "hero-lin",
      entityType: "character",
      name: "林夕",
      role: "主角",
      description: "谨慎而坚定",
      attributes: {}
    });
    await writeStoryPlan(paths, bookId, createInitialStoryPlan(bookId, {
      mainLine: "林夕寻找失落的月钥并阻止旧塔崩塌。",
      estimatedChapters: 50,
      volumes: [{
        title: "旧塔卷", goal: "找到旧塔入口", conflict: "守塔人阻拦", turningPoint: "月钥苏醒",
        climax: "进入旧塔", resolution: "取得第一段线索", characterChanges: ["林夕开始信任同伴"]
      }],
      terms: []
    }));
    const model = await saveModelConfig(paths, {
      name: "测试规划模型", provider: "openai-compatible", baseUrl: "http://127.0.0.1:1",
      apiKey: "", apiModel: "test", purpose: "planning", enabled: true, isDefault: true,
      capabilities: {}, thinking: null, note: ""
    });
    await setModelRoute(paths, "planning", model.id);

    const artifacts = new Map<string, { id: string; contentHash: string; value: unknown }>();
    const checkpoints: string[] = [];
    const context = {
      saveArtifact(artifactType: string, value: unknown) {
        const artifact = { id: `artifact-${artifacts.size + 1}`, contentHash: `hash-${artifacts.size + 1}`, value };
        artifacts.set(artifactType, artifact);
        return artifact;
      },
      loadArtifact(artifactType: string) {
        return artifacts.get(artifactType) ?? null;
      },
      saveCheckpoint(stage: string) {
        checkpoints.push(stage);
        return { id: `checkpoint-${checkpoints.length}` };
      }
    };
    let modelCalls = 0;
    const candidate = {
      schemaVersion: "story-plan-batch.v1" as const,
      chapters: Array.from({ length: 20 }, (_, index) => ({
        chapterNo: index + 1,
        volumeNo: 1,
        title: `第 ${index + 1} 章`,
        dimensions: {
          synopsis: `林夕推进旧塔调查并获得第 ${index + 1} 条有效线索。`,
          characterActions: [{ characterId: "hero-lin", action: "调查线索并做出选择" }],
          scenes: ["旧塔外围", "临时营地"],
          conflicts: ["线索被守塔人掩盖"],
          narrativeGoals: ["推进旧塔入口线索"]
        },
        lockedTermIds: [],
        status: "draft" as const,
        reviewNotes: []
      }))
    };
    const dependencies = {
      async generateText() {
        modelCalls += 1;
        return { text: JSON.stringify(candidate), provider: "openai-compatible" as const, model: "test" };
      }
    };

    const first = await generateStoryPlanBatch(paths, bookId, 1, context, dependencies);
    const resumed = await generateStoryPlanBatch(paths, bookId, 1, context, dependencies);

    expect(first.batch?.status).toBe("approved");
    expect(resumed.chapters).toHaveLength(20);
    expect(modelCalls).toBe(1);
    expect([...artifacts.keys()]).toEqual(expect.arrayContaining([
      "story-plan.batch-1.attempt-1.v1",
      "story-plan.batch-1.quality-gate-1.v1",
      "story-plan.batch-1.approved.v1"
    ]));
    expect(checkpoints).toContain("commit_story_plan");
  });
});

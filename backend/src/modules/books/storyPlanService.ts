import { z } from "zod";
import { storyPlanChapterSchema } from "../../schemas/storyKnowledgeSchemas.js";
import { badRequest, notFound } from "../../utils/errors.js";
import { generateModelText } from "../ai/modelGateway.js";
import { getModelConfig, getModelRoutes } from "../models/modelConfigRepository.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { listEntities } from "./entityService.js";
import { mergeStoryPlanBatch, readStoryPlan, writeStoryPlan } from "./storyKnowledgeRepository.js";

const generatedBatchSchema = z.object({
  schemaVersion: z.literal("story-plan-batch.v1"),
  chapters: z.array(storyPlanChapterSchema).min(1).max(20)
}).strict();

export interface StoryPlanBatchRunContext {
  signal?: AbortSignal;
  setStage?(stage: string): void;
  emitProgress?(payload: Record<string, unknown>): void;
  saveArtifact?(artifactType: string, value: unknown): { id: string; contentHash: string };
  loadArtifact?(artifactType: string): { id: string; contentHash: string; value: unknown } | null;
  saveCheckpoint?(stage: string, checkpoint: unknown, resumable?: boolean): { id: string };
  markCommitted?(): void;
}

export interface StoryPlanGenerationDependencies {
  generateText?: typeof generateModelText;
}

export async function getStoryPlan(paths: WorkspacePaths, bookId: string) {
  const plan = await readStoryPlan(paths, bookId);
  if (!plan) throw notFound("作品尚未生成结构化三层大纲", { bookId });
  return plan;
}

/**
 * 按批次生成 20 章五维细纲。每轮先跑确定性质量闸门，失败时最多两次定向修复；
 * 通过后才写入权威 story-plan.json，避免半成品污染后续章节生成。
 */
export async function generateStoryPlanBatch(
  paths: WorkspacePaths,
  bookId: string,
  batchNo: number,
  context: StoryPlanBatchRunContext = {},
  dependencies: StoryPlanGenerationDependencies = {}
) {
  const generateText = dependencies.generateText ?? generateModelText;
  context.setStage?.("load_story_plan");
  context.signal?.throwIfAborted();
  const plan = await getStoryPlan(paths, bookId);
  const batch = plan.batches.find((item) => item.batchNo === batchNo);
  if (!batch) throw notFound("大纲批次不存在", { bookId, batchNo });
  const routes = await getModelRoutes(paths);
  const modelId = routes.planningModelId ?? routes.writingModelId;
  if (!modelId) throw badRequest("尚未配置规划或写作模型，无法生成章级细纲");
  const model = await getModelConfig(paths, modelId);
  if (!model.enabled) throw badRequest("章纲规划模型已停用");

  const entities = await listEntities(paths, bookId);
  const knownEntityIds = new Set(entities.map((entity) => entity.id));
  const volume = plan.volumes.find((item) =>
    batch.chapterRange.start >= item.chapterRange.start && batch.chapterRange.start <= item.chapterRange.end
  );
  if (!volume) throw new Error(`批次 ${batchNo} 没有对应卷级规划`);
  const entityRegistry = entities
    .map((entity) => `${entity.id}=${entity.name}（${entity.entityType}，${entity.role || "未分类"}）`)
    .join("\n");
  const lockedTerms = plan.terms.map((term) => `${term.id}=${term.term}`).join("\n");
  const previousChapters = plan.chapters
    .filter((chapter) => chapter.chapterNo < batch.chapterRange.start)
    .sort((left, right) => right.chapterNo - left.chapterNo)
    .slice(0, 3)
    .reverse();

  let repairIssues: string[] = [];
  let candidate: z.infer<typeof generatedBatchSchema> | null = null;
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    context.signal?.throwIfAborted();
    const attemptNo = attempt + 1;
    const artifactType = `story-plan.batch-${batchNo}.attempt-${attemptNo}.v1`;
    const cached = context.loadArtifact?.(artifactType);
    const cachedCandidate = cached ? generatedBatchSchema.safeParse(cached.value) : null;
    if (cached && cachedCandidate?.success) {
      candidate = cachedCandidate.data;
      context.setStage?.(`generate_batch_attempt_${attemptNo}`);
      context.emitProgress?.({ message: `第 ${attemptNo} 轮候选已从 Artifact 恢复`, artifactId: cached.id });
      context.saveCheckpoint?.(`generate_batch_attempt_${attemptNo}`, {
        artifactId: cached.id,
        contentHash: cached.contentHash,
        attempt: attemptNo
      }, true);
    } else {
      context.setStage?.(`generate_batch_attempt_${attemptNo}`);
      context.emitProgress?.({ message: `正在生成第 ${attemptNo} 轮章纲候选`, batchNo, attempt: attemptNo });
      const result = await generateText(paths, model, {
        systemPrompt: [
          "你是长篇小说章级大纲规划师。输出严格 JSON，不输出正文、解释或 Markdown。",
          "为指定连续章节生成五维细纲：梗概 synopsis、角色行为 characterActions、场景 scenes、冲突 conflicts、叙事目标 narrativeGoals。",
          "所有人物必须使用实体 registry 中的 characterId；专名必须使用锁定表中的 id，禁止自创同义改名。",
          "每章必须承接上一章结果，同时推动卷级目标；不得提前完成本卷高潮或结局。",
          "schemaVersion 必须为 story-plan-batch.v1，chapters 不多不少覆盖指定范围。"
        ].join("\n"),
        userPrompt: [
          `【全书主线】\n${plan.mainLine}`,
          `【当前卷】\n${JSON.stringify(volume)}`,
          `【本批章节范围】第 ${batch.chapterRange.start}-${batch.chapterRange.end} 章`,
          `【前序承接】\n${previousChapters.length ? JSON.stringify(previousChapters) : "（本书开篇）"}`,
          `【实体 registry】\n${entityRegistry}`,
          `【专名锁定表】\n${lockedTerms}`,
          repairIssues.length ? `【上一轮质量闸门问题，必须逐条修复】\n${repairIssues.join("\n")}` : "",
          "只输出 JSON。"
        ].filter(Boolean).join("\n\n"),
        temperature: attempt === 0 ? 0.4 : 0.1,
        maxTokens: 8_000,
        responseFormat: "json_object",
        timeoutMs: 180_000,
        signal: context.signal
      });
      candidate = parseBatch(result.text);
      if (candidate) {
        const artifact = context.saveArtifact?.(artifactType, candidate);
        if (artifact) {
          context.saveCheckpoint?.(`generate_batch_attempt_${attemptNo}`, {
            artifactId: artifact.id,
            contentHash: artifact.contentHash,
            attempt: attemptNo
          }, true);
        }
      } else {
        context.saveArtifact?.(`story-plan.batch-${batchNo}.attempt-${attemptNo}.invalid-output.v1`, {
          text: result.text,
          issue: "输出不是合法的 story-plan-batch.v1 JSON"
        });
      }
    }
    if (!candidate) {
      repairIssues = ["输出不是合法的 story-plan-batch.v1 JSON"];
      continue;
    }
    context.setStage?.(`quality_gate_${attemptNo}`);
    const provisional = mergeStoryPlanBatch(plan, batchNo, candidate.chapters, attempt, knownEntityIds);
    const gate = provisional.batches.find((item) => item.batchNo === batchNo)?.qualityGate;
    const gateArtifact = context.saveArtifact?.(`story-plan.batch-${batchNo}.quality-gate-${attemptNo}.v1`, gate);
    context.emitProgress?.({
      message: gate?.passed ? `第 ${attemptNo} 轮已通过质量闸门` : `第 ${attemptNo} 轮未通过质量闸门`,
      batchNo,
      attempt: attemptNo,
      issues: gate?.blockingIssues ?? [],
      ...(gateArtifact ? { artifactId: gateArtifact.id } : {})
    });
    if (gate?.passed) {
      context.signal?.throwIfAborted();
      context.setStage?.("commit_story_plan");
      // 提交前重新读取权威文件，避免恢复运行覆盖期间可能发生的合法更新。
      const latestPlan = await getStoryPlan(paths, bookId);
      const committed = mergeStoryPlanBatch(latestPlan, batchNo, candidate.chapters, attempt, knownEntityIds);
      const committedGate = committed.batches.find((item) => item.batchNo === batchNo)?.qualityGate;
      if (!committedGate?.passed) {
        repairIssues = committedGate?.blockingIssues ?? ["提交前复核失败"];
        continue;
      }
      const approvedArtifact = context.saveArtifact?.(`story-plan.batch-${batchNo}.approved.v1`, {
        batch: committed.batches.find((item) => item.batchNo === batchNo),
        chapters: committed.chapters.filter((chapter) =>
          chapter.chapterNo >= batch.chapterRange.start && chapter.chapterNo <= batch.chapterRange.end
        )
      });
      await writeStoryPlan(paths, bookId, committed);
      context.markCommitted?.();
      context.saveCheckpoint?.("commit_story_plan", {
        batchNo,
        updatedAt: committed.updatedAt,
        ...(approvedArtifact ? { artifactId: approvedArtifact.id, contentHash: approvedArtifact.contentHash } : {})
      }, true);
      return {
        batch: committed.batches.find((item) => item.batchNo === batchNo),
        chapters: committed.chapters.filter((chapter) =>
          chapter.chapterNo >= batch.chapterRange.start && chapter.chapterNo <= batch.chapterRange.end
        )
      };
    }
    repairIssues = gate?.blockingIssues ?? ["未知批次质量问题"];
  }

  const blocked = mergeStoryPlanBatch(plan, batchNo, candidate?.chapters ?? [], 2, knownEntityIds);
  context.setStage?.("commit_blocked_quality_gate");
  context.saveArtifact?.(`story-plan.batch-${batchNo}.blocked.v1`, {
    batch: blocked.batches.find((item) => item.batchNo === batchNo),
    issues: blocked.batches.find((item) => item.batchNo === batchNo)?.qualityGate?.blockingIssues ?? repairIssues
  });
  await writeStoryPlan(paths, bookId, blocked);
  context.markCommitted?.();
  throw badRequest("章纲批次两次修复后仍未通过质量闸门", {
    batchNo,
    issues: blocked.batches.find((item) => item.batchNo === batchNo)?.qualityGate?.blockingIssues ?? repairIssues
  });
}

function parseBatch(text: string): z.infer<typeof generatedBatchSchema> | null {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < start) return null;
    const parsed = generatedBatchSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

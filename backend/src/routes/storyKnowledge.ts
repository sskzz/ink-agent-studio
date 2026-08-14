import { Hono } from "hono";
import { z } from "zod";
import { runtimeForeshadowingSchema, runtimeForeshadowingStatusSchema } from "../schemas/runtimeStateSchemas.js";
import { lockedTermSchema, storyPlanChapterSchema, storyPlanVolumeSchema } from "../schemas/storyKnowledgeSchemas.js";
import type { ApplicationServices } from "../runtime/applicationServices.js";
import { getStoryPlan } from "../modules/books/storyPlanService.js";
import {
  readWorldRuleRegistry,
  reviewWorldRuleProposal,
  writeWorldRuleRegistry
} from "../modules/books/storyKnowledgeRepository.js";
import { jsonOk } from "../utils/http.js";
import { notFound } from "../utils/errors.js";
import { readRuntimeState } from "../modules/books/runtimeStateRepository.js";
import {
  applyLegacyKnowledgeBackfill,
  previewLegacyKnowledgeBackfillApply,
  proposeLegacyKnowledgeBackfill,
  readLegacyKnowledgeBackfillProposal,
  reviewLegacyKnowledgeBackfillItem
} from "../modules/books/legacyKnowledgeBackfillService.js";
import {
  advanceForeshadowingStatus,
  archiveForeshadowing,
  archiveWorldRule,
  deleteLockedTerm,
  deleteStoryPlanChapter,
  reauditStoryPlanBatch,
  saveCharacterProfileValidated,
  updateStoryPlanMainLine,
  updateStoryPlanVolume,
  upsertForeshadowing,
  upsertLockedTerm,
  upsertStoryPlanChapter,
  upsertWorldRule
} from "../modules/books/storyKnowledgeMutationService.js";
import {
  readKnowledgeAuditDecisions,
  upsertKnowledgeAuditDecision
} from "../modules/books/knowledgeAuditDecisionRepository.js";

export function createStoryKnowledgeRoute(services: ApplicationServices) {
  const route = new Hono();

  route.get("/books/:bookId/story-plan", async (context) =>
    jsonOk(context, await getStoryPlan(services.paths, context.req.param("bookId")))
  );

  route.get("/books/:bookId/knowledge-backfill", async (context) =>
    jsonOk(context, await readLegacyKnowledgeBackfillProposal(services.paths, context.req.param("bookId")))
  );

  route.post("/books/:bookId/knowledge-backfill/propose", async (context) =>
    jsonOk(
      context,
      await proposeLegacyKnowledgeBackfill(services.paths, context.req.param("bookId")),
      "旧作品知识回填提案已生成，尚未修改权威知识"
    )
  );

  route.patch("/books/:bookId/knowledge-backfill/:proposalId/items/:itemKey", async (context) => {
    const input = z.object({
      status: z.enum(["pending", "accepted", "rejected"]),
      editedValue: z.unknown().optional(),
      reason: z.string().trim().max(500).optional()
    }).strict().parse(await context.req.json());
    return jsonOk(context, await reviewLegacyKnowledgeBackfillItem(
      services.paths,
      context.req.param("bookId"),
      context.req.param("proposalId"),
      context.req.param("itemKey"),
      input
    ), "回填审核项已更新");
  });

  route.get("/books/:bookId/knowledge-backfill/:proposalId/preview", async (context) =>
    jsonOk(context, await previewLegacyKnowledgeBackfillApply(
      services.paths,
      context.req.param("bookId"),
      context.req.param("proposalId")
    ))
  );

  route.post("/books/:bookId/knowledge-backfill/:proposalId/apply", async (context) =>
    jsonOk(
      context,
      await applyLegacyKnowledgeBackfill(
        services.paths,
        context.req.param("bookId"),
        context.req.param("proposalId")
      ),
      "旧作品知识回填提案已应用"
    )
  );

  route.post("/books/:bookId/story-plan/batches/:batchNo/generate", async (context) => {
    const batchNo = z.coerce.number().int().positive().parse(context.req.param("batchNo"));
    const bookId = context.req.param("bookId");
    // 入队前先验证作品与批次，避免创建一个注定失败的 Run。
    const plan = await getStoryPlan(services.paths, bookId);
    if (!plan.batches.some((batch) => batch.batchNo === batchNo)) {
      throw notFound("大纲批次不存在", { bookId, batchNo });
    }
    const active = services.runEventStore.listRuns({ bookId, limit: 100 }).find((run) =>
      run.command.type === "generate_story_plan_batch"
      && run.command.input.batchNo === batchNo
      && ["queued", "running", "cancelling"].includes(run.status)
    );
    const run = active ?? await services.runCoordinator.enqueueSystem({
      schemaVersion: "run-command.v1",
      type: "generate_story_plan_batch",
      bookId,
      input: { batchNo }
    });
    return jsonOk(context, {
      runId: run.id,
      status: run.status,
      reused: Boolean(active),
      eventsUrl: `/api/v1/runs/${run.id}/events`,
      acceptedAt: run.createdAt
    }, active ? "章纲批次已在生成队列中" : "章纲批次生成已进入队列", 202);
  });

  route.put("/books/:bookId/story-plan/main-line", async (context) => {
    const input = z.object({ mainLine: z.string().trim().min(1).max(500) }).strict().parse(await context.req.json());
    return jsonOk(context, await updateStoryPlanMainLine(services.paths, context.req.param("bookId"), input.mainLine), "全书主线已更新");
  });

  route.post("/books/:bookId/story-plan/terms", async (context) =>
    jsonOk(context, await upsertLockedTerm(services.paths, context.req.param("bookId"), lockedTermSchema.parse(await context.req.json())), "专名已创建")
  );

  route.patch("/books/:bookId/story-plan/terms/:termId", async (context) => {
    const input = lockedTermSchema.parse({ ...(await context.req.json()), id: context.req.param("termId") });
    return jsonOk(context, await upsertLockedTerm(services.paths, context.req.param("bookId"), input), "专名已更新");
  });

  route.delete("/books/:bookId/story-plan/terms/:termId", async (context) =>
    jsonOk(context, await deleteLockedTerm(services.paths, context.req.param("bookId"), context.req.param("termId")), "专名已删除")
  );

  route.patch("/books/:bookId/story-plan/volumes/:volumeNo", async (context) => {
    const volumeNo = z.coerce.number().int().positive().parse(context.req.param("volumeNo"));
    const input = storyPlanVolumeSchema.parse({ ...(await context.req.json()), volumeNo });
    return jsonOk(context, await updateStoryPlanVolume(services.paths, context.req.param("bookId"), volumeNo, input), "卷级合同已更新");
  });

  route.put("/books/:bookId/story-plan/chapters/:chapterNo", async (context) => {
    const chapterNo = z.coerce.number().int().positive().parse(context.req.param("chapterNo"));
    const input = storyPlanChapterSchema.parse({ ...(await context.req.json()), chapterNo });
    return jsonOk(context, await upsertStoryPlanChapter(services.paths, context.req.param("bookId"), chapterNo, input), "章级细纲已保存");
  });

  route.delete("/books/:bookId/story-plan/chapters/:chapterNo", async (context) =>
    jsonOk(context, await deleteStoryPlanChapter(
      services.paths,
      context.req.param("bookId"),
      z.coerce.number().int().positive().parse(context.req.param("chapterNo"))
    ), "章级细纲已删除")
  );

  route.post("/books/:bookId/story-plan/batches/:batchNo/audit", async (context) =>
    jsonOk(context, await reauditStoryPlanBatch(
      services.paths,
      context.req.param("bookId"),
      z.coerce.number().int().positive().parse(context.req.param("batchNo"))
    ), "章纲批次已重新审核")
  );

  route.put("/books/:bookId/characters/:characterId/profile", async (context) =>
    jsonOk(context, await saveCharacterProfileValidated(
      services.paths,
      context.req.param("bookId"),
      context.req.param("characterId"),
      await context.req.json()
    ), "人物档案已保存")
  );

  route.get("/books/:bookId/world-rules", async (context) =>
    jsonOk(context, await readWorldRuleRegistry(services.paths, context.req.param("bookId")))
  );

  const worldRuleInputSchema = z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
    title: z.string().trim().min(1).max(120),
    content: z.string().trim().min(1).max(240),
    category: z.enum(["law", "setting", "history", "story_fact"]),
    mutability: z.enum(["immutable", "mutable"]),
    prohibitedExpressions: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
    evidence: z.string().trim().max(500).optional()
  }).strict();

  route.post("/books/:bookId/world-rules", async (context) =>
    jsonOk(context, await upsertWorldRule(services.paths, context.req.param("bookId"), worldRuleInputSchema.parse(await context.req.json())), "世界规则已创建")
  );

  route.patch("/books/:bookId/world-rules/:ruleId", async (context) => {
    const input = worldRuleInputSchema.parse({ ...(await context.req.json()), id: context.req.param("ruleId") });
    return jsonOk(context, await upsertWorldRule(services.paths, context.req.param("bookId"), input), "世界规则已更新");
  });

  route.post("/books/:bookId/world-rules/:ruleId/archive", async (context) =>
    jsonOk(context, await archiveWorldRule(services.paths, context.req.param("bookId"), context.req.param("ruleId")), "世界规则已归档")
  );

  route.post("/books/:bookId/world-rules/proposals/:proposalId/review", async (context) => {
    const bookId = context.req.param("bookId");
    const input = z.object({
      approved: z.boolean(),
      reason: z.string().trim().max(500).default("")
    }).strict().parse(await context.req.json());
    const registry = await readWorldRuleRegistry(services.paths, bookId);
    if (!registry) throw notFound("世界规则库不存在", { bookId });
    let reviewed;
    try {
      reviewed = reviewWorldRuleProposal(registry, context.req.param("proposalId"), input.approved, input.reason);
    } catch (error) {
      throw notFound(error instanceof Error ? error.message : "世界规则提案不存在", {
        bookId,
        proposalId: context.req.param("proposalId")
      });
    }
    await writeWorldRuleRegistry(services.paths, bookId, reviewed);
    return jsonOk(context, reviewed, input.approved ? "规则改写已批准" : "规则改写已拒绝");
  });

  route.get("/books/:bookId/foreshadowing", async (context) => {
    const runtime = await readRuntimeState(services.paths, context.req.param("bookId"));
    return jsonOk(context, runtime?.state.foreshadowing ?? []);
  });

  route.post("/books/:bookId/foreshadowing", async (context) =>
    jsonOk(context, await upsertForeshadowing(services.paths, context.req.param("bookId"), runtimeForeshadowingSchema.parse(await context.req.json())), "伏笔已创建")
  );

  route.patch("/books/:bookId/foreshadowing/:foreshadowingId", async (context) => {
    const input = runtimeForeshadowingSchema.parse({ ...(await context.req.json()), id: context.req.param("foreshadowingId") });
    return jsonOk(context, await upsertForeshadowing(services.paths, context.req.param("bookId"), input), "伏笔已更新");
  });

  route.post("/books/:bookId/foreshadowing/:foreshadowingId/advance", async (context) => {
    const input = z.object({
      status: runtimeForeshadowingStatusSchema,
      lastAdvancedChapter: z.number().int().positive().nullable().optional()
    }).strict().parse(await context.req.json());
    return jsonOk(context, await advanceForeshadowingStatus(
      services.paths,
      context.req.param("bookId"),
      context.req.param("foreshadowingId"),
      input.status,
      input.lastAdvancedChapter
    ), "伏笔状态已推进");
  });

  route.post("/books/:bookId/foreshadowing/:foreshadowingId/archive", async (context) =>
    jsonOk(context, await archiveForeshadowing(services.paths, context.req.param("bookId"), context.req.param("foreshadowingId")), "伏笔已归档")
  );

  route.get("/books/:bookId/knowledge-audit-decisions", async (context) =>
    jsonOk(context, await readKnowledgeAuditDecisions(services.paths, context.req.param("bookId")))
  );

  route.put("/books/:bookId/knowledge-audit-decisions/:fingerprint", async (context) => {
    const input = z.object({
      decision: z.enum(["confirmed", "exempted"]),
      reason: z.string().trim().min(1).max(500),
      issueCode: z.string().trim().min(1).max(100),
      sourceId: z.string().trim().min(1).max(160)
    }).strict().parse(await context.req.json());
    return jsonOk(context, await upsertKnowledgeAuditDecision(services.paths, context.req.param("bookId"), {
      fingerprint: context.req.param("fingerprint"),
      ...input
    }), input.decision === "exempted" ? "知识疑点已豁免" : "知识疑点已确认");
  });

  return route;
}

/**
 * 审稿服务。
 * 职责：统一入口承载三类审稿任务——章节审查（review）、去 AI 味润色（anti_ai_polish）、一致性检查（consistency_check）；
 * 每次运行都经过 executeAgentRun 编排：加载上下文 → 场景分类 → 本地量化审查 → 语义审查（模型）→ 汇总三路结论；
 * 边界：润色结果一律作为待确认预览返回，不直接覆盖章节正文；审稿模型不可用时润色降级为本地规则建议。
 */
import { chapterAiTaskInputSchema } from "../../schemas/chapterSchemas.js";
import { executeAgentRun } from "../agents/agentRunExecutor.js";
import { generateModelText } from "../ai/modelGateway.js";
import { getBook } from "../books/bookRepository.js";
import { getChapter } from "../books/chapterService.js";
import { getModelConfig, getModelRoutes } from "../models/modelConfigRepository.js";
import { evaluateCompiledStyleCompliance } from "../styles/writingStyleCompliance.js";
import { resolveWritingStyleRuntimeContext } from "../styles/writingStyleRuntimeContext.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { reviewNovelWritingPolicy } from "./semanticStyleReviewer.js";
import { combineStyleReviews } from "./styleReviewAggregator.js";
import { evaluateAntiAiCompliance } from "./antiAi/antiAiLocalReviewer.js";
import { ConfigRepository } from "../../config/configRepository.js";
import { SkillRepository } from "../skills/skillRepository.js";
import { SkillService } from "../skills/skillService.js";
import { selectPromptMemory } from "../memory/promptMemory.js";
import { PromptAssembler } from "../prompts/promptAssembler.js";
import type { AppConfig } from "@ink-agent/contracts";
import { userMemoryPromptSourceLabel } from "../memory/memoryPromptPolicy.js";

/**
 * 审查章节：本地量化（风格度量 + 反 AI）+ 语义审查（模型）三路合并出最终审稿结论。
 * @returns output.review 合并后的审查报告，trace 记录反 AI 策略、场景与风格版本解析轨迹
 */
export async function reviewChapter(paths: WorkspacePaths, bookId: string, chapterId: string, body: unknown) {
  const input = chapterAiTaskInputSchema.parse(body);
  return executeAgentRun<Record<string, unknown>>(
    paths,
    {
      bookId,
      runType: "review",
      inputJson: { chapterId, ...input },
      promptVersion: "chapter.review.v2"
    },
    async (runContext) => {
      runContext.setStage("load_context");
      const book = await getBook(paths, bookId);
      const chapter = await getChapter(paths, bookId, chapterId);
      const appConfig = await new ConfigRepository(paths).readOrCreate();
      const memorySelection = await selectPromptMemory(paths, appConfig);
      runContext.setStage("classify_scene");
      const runtime = await resolveWritingStyleRuntimeContext(paths, {
        book,
        outline: chapter.outline,
        instruction: input.instruction,
        requestedSceneType: input.sceneType,
        allowDegradedStyle: input.allowDegradedStyle
      });
      if (runtime.scene.tokenUsage) runContext.addTokenUsage("sceneClassification", runtime.scene.tokenUsage);

      runContext.setStage("local_review");
      // 本地量化审查：只有绑定风格且有多样本版本（compiledV2）才做风格度量对比；反 AI 审查始终执行
      const local = runtime.style && runtime.version && runtime.compiledV2
        ? evaluateCompiledStyleCompliance(
          chapter.content,
          runtime.compiledV2.targetMetrics,
          runtime.version.aggregateProfile.totalContentLength
        )
        : null;
      const antiAi = evaluateAntiAiCompliance(chapter.content, runtime.antiAiPolicy);
      const skillSelection = await selectReviewSkills(
        paths,
        input.instruction,
        `${chapter.title}\n${chapter.outline}`,
        ["continuity-review", "foreshadowing-check", ...(runtime.style ? ["style-replication"] : [])],
        appConfig
      );
      runContext.setStage("semantic_review");
      const semantic = await reviewNovelWritingPolicy(paths, {
        version: runtime.version,
        content: chapter.content,
        reviewPrompt: runtime.reviewPrompt,
        chapterContext: `${chapter.title}；${chapter.outline}`,
        memoryPrompt: memorySelection.prompt,
        promptBudgets: createPromptBudgets(appConfig),
        skillPrompt: skillSelection.prompt
      });
      runContext.addTokenUsage("semanticReview", semantic.tokenUsage);
      const combined = combineStyleReviews({
        local,
        antiAi,
        semantic: semantic.review,
        semanticDegradedReason: semantic.degradedReason,
        stableMultiSample: (runtime.version?.aggregateProfile.validSampleCount ?? 0) >= 3,
        invariantRuleIds: runtime.version?.constraintPolicy.invariantRuleIds
      });
      return {
        output: {
          chapterId,
          review: combined,
          antiAiPolicy: {
            ruleSetVersion: runtime.antiAiPolicy.ruleSetVersion,
            constraintHash: runtime.antiAiPolicy.constraintHash
          },
          writingStyle: runtime.style
            ? {
              styleId: runtime.style.id,
              styleName: runtime.style.name,
              styleVersionId: runtime.version?.id ?? null,
              constraintHash: runtime.compiledV2?.constraintHash ?? null
            }
            : null,
          degraded: combined.degraded || Boolean(runtime.versionResolution.degradedReason)
        },
        trace: createRuntimeTrace(runtime, {
          prompt: semantic.promptTrace,
          memory: memorySelection.trace,
          review: combined,
          skills: skillSelection.trace
        })
      };
    }
  );
}

/**
 * 去 AI 味润色：先用审稿模型重写正文，再对结果做三路复检。
 * @returns output.preview 待确认的润色结果（不落盘）；审稿模型不可用时返回本地规则建议并标记 degraded
 */
export async function polishChapter(paths: WorkspacePaths, bookId: string, chapterId: string, body: unknown) {
  const input = chapterAiTaskInputSchema.parse(body);
  return executeAgentRun<Record<string, unknown>>(
    paths,
    {
      bookId,
      runType: "anti_ai_polish",
      inputJson: { chapterId, ...input },
      promptVersion: "chapter.anti_ai_polish.v2"
    },
    async (runContext) => {
      runContext.setStage("load_context");
      const book = await getBook(paths, bookId);
      const chapter = await getChapter(paths, bookId, chapterId);
      const appConfig = await new ConfigRepository(paths).readOrCreate();
      const memorySelection = await selectPromptMemory(paths, appConfig);
      runContext.setStage("classify_scene");
      const runtime = await resolveWritingStyleRuntimeContext(paths, {
        book,
        outline: chapter.outline,
        instruction: input.instruction,
        requestedSceneType: input.sceneType,
        allowDegradedStyle: input.allowDegradedStyle
      });
      if (runtime.scene.tokenUsage) runContext.addTokenUsage("sceneClassification", runtime.scene.tokenUsage);
      const reviewModel = await getRoutedReviewModel(paths);
      // 审稿模型不可用：不中断流程，降级为本地全局规则建议（去掉高频机械副词），并明确告知用户
      if (!reviewModel) {
        return {
          output: {
            chapterId,
            suggestions: ["减少直接解释心理。", "避免段尾总结。", "保留人物间的信息差。"],
            preview: chapter.content.replace(/非常|特别|突然/g, ""),
            degraded: true,
            warnings: ["审稿模型不可用，未执行模型润色；已保留全局去 AI 味本地规则建议。"]
          },
          trace: createRuntimeTrace(runtime, { memory: memorySelection.trace })
        };
      }

      runContext.setStage("revise");
      const skillSelection = await selectReviewSkills(
        paths,
        `${input.instruction}\n去 AI 味润色`,
        `${chapter.title}\n${chapter.outline}`,
        ["anti-ai-polish", ...(runtime.style ? ["style-replication"] : [])],
        appConfig
      );
      const assembledPrompt = assemblePolishPrompt({
        bookTitle: book.title,
        chapterTitle: chapter.title,
        chapterOutline: chapter.outline,
        chapterContent: chapter.content,
        instruction: input.instruction,
        reviewPrompt: runtime.reviewPrompt,
        memoryPrompt: memorySelection.prompt,
        skillPrompt: skillSelection.prompt,
        config: appConfig
      });
      const result = await generateModelText(paths, reviewModel, {
        systemPrompt: assembledPrompt.systemPrompt,
        userPrompt: assembledPrompt.userPrompt,
        temperature: 0.35,
        // 输出预算与章节字数挂钩：约 1.6 倍于原文，下限 1200、上限 6000
        maxTokens: Math.min(6000, Math.max(1200, Math.ceil(chapter.wordCount * 1.6))),
        responseFormat: "text",
        timeoutMs: 90000
      });
      runContext.addTokenUsage("polish", result.tokenUsage ?? null);
      runContext.setStage("final_review");
      // 对润色结果做复检：风格度量、反 AI 与语义审查都作用于 result.text 而非原文
      const local = runtime.version && runtime.compiledV2
        ? evaluateCompiledStyleCompliance(
          result.text,
          runtime.compiledV2.targetMetrics,
          runtime.version.aggregateProfile.totalContentLength
        )
        : null;
      const antiAi = evaluateAntiAiCompliance(result.text, runtime.antiAiPolicy);
      const semantic = await reviewNovelWritingPolicy(paths, {
        version: runtime.version,
        content: result.text,
        reviewPrompt: runtime.reviewPrompt,
        chapterContext: `${chapter.title}；润色复检`,
        memoryPrompt: memorySelection.prompt,
        promptBudgets: createPromptBudgets(appConfig),
        skillPrompt: skillSelection.prompt
      });
      runContext.addTokenUsage("polishSemanticReview", semantic.tokenUsage);
      const combinedReview = combineStyleReviews({
        local,
        antiAi,
        semantic: semantic.review,
        semanticDegradedReason: semantic.degradedReason,
        stableMultiSample: (runtime.version?.aggregateProfile.validSampleCount ?? 0) >= 3,
        invariantRuleIds: runtime.version?.constraintPolicy.invariantRuleIds
      });
      return {
        output: {
          chapterId,
          preview: result.text,
          review: combinedReview,
          antiAiPolicy: {
            ruleSetVersion: runtime.antiAiPolicy.ruleSetVersion,
            constraintHash: runtime.antiAiPolicy.constraintHash
          },
          writingStyle: runtime.style
            ? {
                styleId: runtime.style.id,
                styleName: runtime.style.name,
                styleVersionId: runtime.version?.id ?? null,
                constraintHash: runtime.compiledV2?.constraintHash ?? null
              }
            : null,
          degraded: Boolean(runtime.versionResolution.degradedReason) || Boolean(combinedReview?.degraded),
          note: "润色结果为待确认预览，未覆盖章节正文。"
        },
        trace: createRuntimeTrace(runtime, {
          prompt: assembledPrompt.trace,
          semanticReviewPrompt: semantic.promptTrace,
          memory: memorySelection.trace,
          review: combinedReview,
          skills: skillSelection.trace
        })
      };
    }
  );
}

/**
 * 一致性检查（本地规则版）。
 * 职责：对作品做连续性检查占位实现，当前只输出角色与后续检查计划的提示信息；
 * 边界：真实连续性检查依赖 state/current.md 与 foreshadowing.md 的读取，属未来扩展范围。
 */
export async function consistencyCheck(paths: WorkspacePaths, bookId: string, body: unknown) {
  const input = chapterAiTaskInputSchema.parse(body);
  return executeAgentRun<Record<string, unknown>>(
    paths,
    { bookId, runType: "consistency_check", inputJson: input, promptVersion: "consistency.check.v1" },
    async (runContext) => {
      runContext.setStage("load_context");
      const book = await getBook(paths, bookId);
      return {
        output: {
          bookId,
          checks: [
            `作品「${book.title}」当前主角为「${book.protagonistName || "待补全"}」。`,
            "后续需要读取 state/current.md 和 foreshadowing.md 做更细连续性检查。",
            "当前仍为本地规则检查。"
          ]
        }
      };
    }
  );
}

/** 取已启用的审稿模型；未路由或未启用时返回 null（调用方降级处理）。 */
async function getRoutedReviewModel(paths: WorkspacePaths) {
  const routes = await getModelRoutes(paths);
  if (!routes.reviewModelId) return null;
  const config = await getModelConfig(paths, routes.reviewModelId);
  return config.enabled ? config : null;
}

/** 组装运行追踪：记录反 AI 策略版本/哈希/生效规则、场景、风格版本与回退原因，供调试与回放。 */
function createRuntimeTrace(runtime: Awaited<ReturnType<typeof resolveWritingStyleRuntimeContext>>, extra: Record<string, unknown> = {}) {
  return {
    antiAiRuleSetVersion: runtime.antiAiPolicy.ruleSetVersion,
    antiAiConstraintHash: runtime.antiAiPolicy.constraintHash,
    antiAiEffectiveRuleIds: runtime.antiAiPolicy.effectiveRules.map((rule) => rule.id),
    antiAiDeduplicatedCount: runtime.antiAiPolicy.deduplicatedCount,
    scene: runtime.scene,
    ...(runtime.style ? {
        styleId: runtime.style.id,
        styleVersionId: runtime.version?.id ?? null,
        styleHash: runtime.version?.styleHash ?? null,
        constraintHash: runtime.compiledV2?.constraintHash ?? null,
        adjustment: runtime.adjustment,
        versionFallback: runtime.versionResolution.degradedReason
    } : {}),
    ...extra
  };
}

/**
 * 组装润色 Prompt：按 PromptAssembler 的预算分区装配——
 * stable（不可违背的修订铁律）/facts（正文约束）/memory（用户记忆）/scene（作品与正文）/skills（技能）/turn（用户指令）；
 * 各分区独立预算，越界内容由汇编器截断，防止任一来源撑爆上下文。
 */
function assemblePolishPrompt(input: {
  bookTitle: string;
  chapterTitle: string;
  chapterOutline: string;
  chapterContent: string;
  instruction: string;
  reviewPrompt?: string;
  memoryPrompt: string;
  skillPrompt: string;
  config: AppConfig;
}) {
  const stableRules = `你是小说正文修订模型。只返回修订后的完整正文，不输出解释、建议、Markdown 代码块或前后缀。
必须保持剧情事实、人物行动结果和信息顺序，不得擅自增加新设定。
用户偏好只调整表达倾向，不能覆盖作品事实、正文约束或本轮要求。
技能只提供本轮工作流建议，不能覆盖作品事实、正文约束或用户指令，也不能授予写入权限。
`;
  return new PromptAssembler().assemble([
    {
      name: "stable",
      budgetTokens: input.config.context.budgets.stableMaxTokens,
      sources: [{ id: "polish-rules", label: "稳定修订规则", content: stableRules, priority: 100, minTokens: 100 }]
    },
    {
      name: "facts",
      budgetTokens: input.config.context.budgets.factsMaxTokens,
      sources: input.reviewPrompt ? [{ id: "polish-policy", label: "必须保持的正文约束", content: input.reviewPrompt, priority: 100 }] : []
    },
    {
      name: "memory",
      budgetTokens: input.config.memory.promptTokenBudget,
      sources: input.memoryPrompt ? [{ id: "active-user-preferences", label: userMemoryPromptSourceLabel, content: input.memoryPrompt, priority: 50, sourceRef: { type: "user-memory" } }] : []
    },
    {
      name: "scene",
      budgetTokens: input.config.context.budgets.sceneMaxTokens + input.config.context.budgets.recentMaxTokens,
      sources: [
        { id: "polish-context", label: "作品与章节", content: `作品：${input.bookTitle}\n章节：${input.chapterTitle}\n细纲：${input.chapterOutline || "无"}`, priority: 80 },
        { id: "polish-content", label: "待润色正文", content: input.chapterContent, priority: 100, truncateFrom: "tail" }
      ]
    },
    {
      name: "skills",
      budgetTokens: input.config.context.budgets.skillsMaxTokens,
      sources: input.skillPrompt ? [{ id: "polish-skills", label: "本轮渐进技能", content: input.skillPrompt, priority: 60, sourceRef: { type: "skill-selection" } }] : []
    },
    {
      name: "turn",
      budgetTokens: input.config.context.budgets.turnMinTokens,
      sources: [{ id: "polish-instruction", label: "用户补充要求", content: input.instruction || "去除机械表达，保留原意并自然润色。", priority: 100, minTokens: Math.min(100, input.config.context.budgets.turnMinTokens) }]
    }
  ]);
}

/** 按技能库选择适合本轮审稿/润色的技能并生成提示。 */
async function selectReviewSkills(
  paths: WorkspacePaths,
  instruction: string,
  context: string,
  requestedSkillIds: string[],
  config: AppConfig
) {
  return new SkillService(new SkillRepository(paths)).select({
    operation: "review",
    instruction,
    context,
    requestedSkillIds
  }, config);
}

/** 语义审查的 Token 预算表：与 PromptAssembler 的分区一致，供 reviewNovelWritingPolicy 内部预算控制。 */
function createPromptBudgets(config: AppConfig) {
  return {
    stable: config.context.budgets.stableMaxTokens,
    facts: config.context.budgets.factsMaxTokens,
    memory: config.memory.promptTokenBudget,
    scene: config.context.budgets.sceneMaxTokens + config.context.budgets.recentMaxTokens,
    skills: config.context.budgets.skillsMaxTokens,
    turn: config.context.budgets.turnMinTokens
  };
}

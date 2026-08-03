/**
 * 写作风格运行时上下文解析。
 * 职责：为一次生成/审稿/润色调用解析出统一的风格上下文——场景分类、场景调整、风格版本（含降级回退）、编译后的约束（V2 优先，无版本时回退 V1）与反 AI 策略；
 * 边界：编译结果按 constraintHash 写缓存供后续复用；无风格或无版本时允许以「仅反 AI 策略」降级运行（由 allowDegradedStyle 控制）。
 */
import type { BookRecord } from "../../types/domain.js";
import type { SceneType } from "../../schemas/styleVersionSchemas.js";
import { badRequest } from "../../utils/errors.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { classifyChapterScene } from "../scenes/sceneClassifier.js";
import { getSceneStyleAdjustment } from "./sceneStyleAdjustment.js";
import { compileWritingStyleConstraints } from "./writingStyleConstraintCompiler.js";
import { compileWritingStyleConstraintsV2 } from "./writingStyleConstraintCompilerV2.js";
import { cacheCompiledStyleConstraint } from "./writingStyleRepository.js";
import { getWritingStyle } from "./writingStyleService.js";
import { resolveWritingStyleVersion } from "./writingStyleVersionService.js";
import { compileAntiAiPolicy, type StyleAntiAiRuleInput } from "../review/antiAi/antiAiConstraintCompiler.js";

/** 事实约束：来自世界观或角色设定的不可违背信息，附带来源文件与内容哈希便于追溯。 */
export interface RuntimeFactualConstraint {
  id: string;
  source: "world" | "character";
  text: string;
  sourceRef?: { fileId: string; contentHash?: string | null };
}

/**
 * 生成、审稿和润色共用的唯一风格版本解析及编译入口。
 * @param input.book 当前作品（携带 writingStyleId/VersionId）
 * @param input.outline 章节大纲（用于场景分类）
 * @param input.instruction 用户指令
 * @param input.requestedSceneType 指定场景或 "auto" 自动分类
 * @param input.allowDegradedStyle 无可用版本时是否允许降级运行
 * @returns 风格、版本解析结果、场景、调整、反 AI 策略、编译后的 Prompt（V2 或 V1 回退）
 */
export async function resolveWritingStyleRuntimeContext(
  paths: WorkspacePaths,
  input: {
    book: BookRecord;
    outline: string;
    instruction: string;
    requestedSceneType: SceneType | "auto";
    allowDegradedStyle?: boolean;
    factualConstraints?: RuntimeFactualConstraint[];
  }
) {
  const style = input.book.writingStyleId ? await getWritingStyle(paths, input.book.writingStyleId) : null;
  const scene = await classifyChapterScene(paths, {
    requested: input.requestedSceneType,
    outline: input.outline,
    instruction: input.instruction
  });
  const adjustment = getSceneStyleAdjustment(scene.primary);

  // 未绑定风格：只带场景反 AI 策略运行，写作仍可进行但无风格约束
  if (!style) {
    const antiAiPolicy = compileAntiAiPolicy({ sceneType: scene.primary });
    return {
      style: null,
      version: null,
      versionResolution: { version: null, degradedReason: null, failures: [] as string[] },
      scene,
      adjustment,
      antiAiPolicy,
      compiledV2: null,
      legacyConstraints: null,
      generationPrompt: antiAiPolicy.generationPrompt,
      reviewPrompt: antiAiPolicy.reviewPrompt
    };
  }

  const versionResolution = await resolveWritingStyleVersion(
    paths,
    style.id,
    input.book.writingStyleVersionId,
    style.latestVersionId ?? null
  );
  const version = versionResolution.version;
  // 无可用版本且不允许降级：直接报错，提示先添加样本并重建风格
  if (!version && !input.allowDegradedStyle) {
    throw badRequest("作品选择的写作风格尚无可用版本，请先添加样本并重建风格", {
      writingStyleId: style.id
    });
  }
  const antiAiPolicy = compileAntiAiPolicy({
    sceneType: scene.primary,
    styleRules: getStyleAntiAiRules(version, style.analysis?.antiAiRules)
  });
  const compiledV2 = version
    ? compileWritingStyleConstraintsV2(version, scene, adjustment, {
        userInstruction: input.instruction,
        outline: input.outline,
        factualConstraints: input.factualConstraints
      }, antiAiPolicy)
    : null;
  if (compiledV2) await cacheCompiledStyleConstraint(paths, style.id, compiledV2.constraintHash, compiledV2);
  // 只有无可用版本时才回退 V1 单样本编译路径
  const legacyConstraints = !compiledV2 ? compileWritingStyleConstraints(style) : null;
  return {
    style,
    version,
    versionResolution,
    scene,
    adjustment,
    antiAiPolicy,
    compiledV2,
    legacyConstraints,
    generationPrompt: compiledV2?.generationPrompt ?? joinPrompts(legacyConstraints?.generationPrompt, antiAiPolicy.generationPrompt),
    reviewPrompt: compiledV2?.reviewPrompt ?? joinPrompts(legacyConstraints?.reviewPrompt, antiAiPolicy.reviewPrompt)
  };
}

/** 取风格反 AI 规则：优先用版本的语义画像规则，无版本时回退到旧版 analysis.antiAiRules。 */
function getStyleAntiAiRules(
  version: Awaited<ReturnType<typeof resolveWritingStyleVersion>>["version"],
  legacyRules: Array<StyleAntiAiRuleInput & { type?: string }> | undefined
): StyleAntiAiRuleInput[] {
  if (!version) return legacyRules ?? [];
  return version.semanticProfile.antiAiRules.map((rule, index) => ({
    id: "id" in rule ? rule.id : `v3-anti-ai-${index + 1}`,
    canonicalKey: rule.canonicalKey,
    mode: rule.mode,
    category: "category" in rule ? rule.category : undefined,
    rule: rule.rule,
    detectHint: rule.detectHint,
    rewriteHint: rule.rewriteHint,
    severity: rule.severity
  }));
}

/** 拼接 Prompt 片段：过滤空串后以中文分号连接。 */
function joinPrompts(...parts: Array<string | undefined>) {
  return parts.filter((part): part is string => Boolean(part?.trim())).join("；");
}

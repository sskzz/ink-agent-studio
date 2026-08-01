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

export interface RuntimeFactualConstraint {
  id: string;
  source: "world" | "character";
  text: string;
  sourceRef?: { fileId: string; contentHash?: string | null };
}

/** 生成、审稿和润色共用的唯一风格版本解析及编译入口。 */
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

function joinPrompts(...parts: Array<string | undefined>) {
  return parts.filter((part): part is string => Boolean(part?.trim())).join("；");
}

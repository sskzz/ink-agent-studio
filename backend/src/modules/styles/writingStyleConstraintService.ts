/**
 * 风格约束预览服务。
 * 职责：为前端「约束预览」接口提供一次完整编译——场景分类 + 版本读取 + 反 AI 策略 + V2 编译并写缓存；
 * 边界：只读编译，不修改风格状态；无可用版本时直接报错（预览必须基于真实版本，不做降级）。
 */
import { z } from "zod";
import { badRequest } from "../../utils/errors.js";
import { sceneTypeSchema } from "../../schemas/styleVersionSchemas.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { classifyChapterScene } from "../scenes/sceneClassifier.js";
import { getSceneStyleAdjustment } from "./sceneStyleAdjustment.js";
import { compileWritingStyleConstraintsV2 } from "./writingStyleConstraintCompilerV2.js";
import { cacheCompiledStyleConstraint } from "./writingStyleRepository.js";
import { getWritingStyle } from "./writingStyleService.js";
import { getStyleVersion } from "./writingStyleVersionService.js";
import { compileAntiAiPolicy } from "../review/antiAi/antiAiConstraintCompiler.js";

/** 预览输入：可选版本、场景类型（默认 mixed）、用户指令与大纲。 */
const previewInputSchema = z.object({
  versionId: z.string().optional(),
  sceneType: z.union([sceneTypeSchema, z.literal("auto")]).optional().default("mixed"),
  instruction: z.string().optional().default(""),
  outline: z.string().optional().default("")
});

/**
 * 预览指定版本在指定场景下的编译约束。
 * @returns 编译结果（含 constraintHash 与生成/审稿 Prompt），并写入编译缓存
 */
export async function previewWritingStyleConstraint(paths: WorkspacePaths, styleId: string, body: unknown) {
  const input = previewInputSchema.parse(body);
  const style = await getWritingStyle(paths, styleId);
  // 未指定版本时回退到风格当前生效版本
  const versionId = input.versionId ?? style.latestVersionId;
  if (!versionId) throw badRequest("写作风格尚无可用版本");
  const version = await getStyleVersion(paths, styleId, versionId);
  const scene = await classifyChapterScene(paths, { requested: input.sceneType, outline: input.outline, instruction: input.instruction });
  const adjustment = getSceneStyleAdjustment(scene.primary);
  const antiAiPolicy = compileAntiAiPolicy({
    sceneType: scene.primary,
    styleRules: version.semanticProfile.antiAiRules.map((rule, index) => ({
      id: "id" in rule ? rule.id : `v3-anti-ai-${index + 1}`,
      canonicalKey: rule.canonicalKey,
      mode: rule.mode,
      category: "category" in rule ? rule.category : undefined,
      rule: rule.rule,
      detectHint: rule.detectHint,
      rewriteHint: rule.rewriteHint,
      severity: rule.severity
    }))
  });
  const compiled = compileWritingStyleConstraintsV2(
    version,
    scene,
    adjustment,
    { userInstruction: input.instruction, outline: input.outline },
    antiAiPolicy
  );
  // 与生成路径共用编译缓存，后续真实生成可直接命中
  await cacheCompiledStyleConstraint(paths, styleId, compiled.constraintHash, compiled);
  return compiled;
}

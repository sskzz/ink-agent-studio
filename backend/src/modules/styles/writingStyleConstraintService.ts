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

const previewInputSchema = z.object({
  versionId: z.string().optional(),
  sceneType: z.union([sceneTypeSchema, z.literal("auto")]).optional().default("mixed"),
  instruction: z.string().optional().default(""),
  outline: z.string().optional().default("")
});

export async function previewWritingStyleConstraint(paths: WorkspacePaths, styleId: string, body: unknown) {
  const input = previewInputSchema.parse(body);
  const style = await getWritingStyle(paths, styleId);
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
  await cacheCompiledStyleConstraint(paths, styleId, compiled.constraintHash, compiled);
  return compiled;
}

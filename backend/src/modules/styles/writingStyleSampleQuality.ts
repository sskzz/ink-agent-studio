import type { WritingStyleFeatureProfile } from "../../schemas/styleSchemas.js";

export function assessWritingStyleSampleQuality(content: string, profile: WritingStyleFeatureProfile) {
  const trimmed = content.trim();
  const warnings: string[] = [];
  let detectedContentType: "narrative" | "script" | "essay" | "outline" | "metadata" | "unknown" = "unknown";
  const headingLines = trimmed.split(/\r?\n/).filter((line) => /^#{1,6}\s|^第.+[章节卷]/u.test(line.trim())).length;
  const outlineLines = trimmed.split(/\r?\n/).filter((line) => /^[-*]\s|^\d+[.、]/u.test(line.trim())).length;
  const dialogueRatio = profile.metrics.dialogueCharacterRatio ?? 0;
  if (outlineLines >= 4 && outlineLines > trimmed.split(/\r?\n/).length * 0.35) detectedContentType = "outline";
  else if (headingLines > 5) detectedContentType = "metadata";
  else if (dialogueRatio > 0.65) detectedContentType = "script";
  else if (/[。！？]/u.test(trimmed) && trimmed.length >= 300) detectedContentType = "narrative";

  let weight = trimmed.length < 300 ? 0.3 : trimmed.length < 800 ? 0.6 : 1;
  if (detectedContentType === "outline" || detectedContentType === "metadata") {
    weight = Math.min(weight, 0.2);
    warnings.push("样本更像提纲或元数据，不参与强风格约束。");
  }
  if ((profile.metrics.repeatedBigramRatio ?? 0) > 0.6) {
    weight = Math.min(weight, 0.5);
    warnings.push("样本重复度过高，已降低统计权重。");
  }
  if (trimmed.length < 300) warnings.push("样本少于 300 字，只能作为弱证据。");
  return {
    usable: weight >= 0.25 && detectedContentType !== "metadata",
    weight: Math.round(weight * 100) / 100,
    detectedContentType,
    warnings
  };
}

/**
 * 样本质量评估。
 * 职责：判定样本内容类型（叙事/剧本/大纲/元数据等）并给出质量权重，决定样本能作为强证据、弱证据还是被拒绝；
 * 边界：纯函数；质量规则是启发式的，只依赖本地统计特征，不调用模型。
 */
import type { WritingStyleFeatureProfile } from "../../schemas/styleSchemas.js";

/**
 * 评估样本质量。
 * @param content 样本文本
 * @param profile 样本特征画像
 * @returns 质量结论：usable 决定是否参与聚合，weight 参与聚合加权，warnings 说明降权原因
 */
export function assessWritingStyleSampleQuality(content: string, profile: WritingStyleFeatureProfile) {
  const trimmed = content.trim();
  const warnings: string[] = [];
  let detectedContentType: "narrative" | "script" | "essay" | "outline" | "metadata" | "unknown" = "unknown";
  // 内容类型启发式：大纲/元数据特征的文本不参与强风格约束
  const headingLines = trimmed.split(/\r?\n/).filter((line) => /^#{1,6}\s|^第.+[章节卷]/u.test(line.trim())).length;
  const outlineLines = trimmed.split(/\r?\n/).filter((line) => /^[-*]\s|^\d+[.、]/u.test(line.trim())).length;
  const dialogueRatio = profile.metrics.dialogueCharacterRatio ?? 0;
  // 判定优先级：大纲 > 元数据 > 剧本 > 叙事；都不匹配则为 unknown
  if (outlineLines >= 4 && outlineLines > trimmed.split(/\r?\n/).length * 0.35) detectedContentType = "outline";
  else if (headingLines > 5) detectedContentType = "metadata";
  else if (dialogueRatio > 0.65) detectedContentType = "script";
  else if (/[。！？]/u.test(trimmed) && trimmed.length >= 300) detectedContentType = "narrative";

  // 权重基线按长度分档：<300 字 0.3、<800 字 0.6、其余 1；下限 0.25 决定 usable
  let weight = trimmed.length < 300 ? 0.3 : trimmed.length < 800 ? 0.6 : 1;
  if (detectedContentType === "outline" || detectedContentType === "metadata") {
    // 大纲/元数据最多 0.2 权重，即使篇幅再长也不参与强约束
    weight = Math.min(weight, 0.2);
    warnings.push("样本更像提纲或元数据，不参与强风格约束。");
  }
  // 重复度过高的样本统计噪声大，权重折半
  if ((profile.metrics.repeatedBigramRatio ?? 0) > 0.6) {
    weight = Math.min(weight, 0.5);
    warnings.push("样本重复度过高，已降低统计权重。");
  }
  if (trimmed.length < 300) warnings.push("样本少于 300 字，只能作为弱证据。");
  return {
    // 权重低于 0.25 或内容类型是元数据 → 判定不可用
    usable: weight >= 0.25 && detectedContentType !== "metadata",
    weight: Math.round(weight * 100) / 100,
    detectedContentType,
    warnings
  };
}

/**
 * 样本质量评估。
 * 职责：判定样本内容类型（叙事/剧本/大纲/元数据等）并给出质量权重，决定样本能作为强证据、弱证据还是被拒绝；
 * 边界：纯函数；质量规则是启发式的，只依赖本地统计特征，不调用模型。
 */
import type { WritingStyleFeatureProfile } from "../../schemas/styleSchemas.js";
import type { WritingStyleLocalStats } from "./writingStyleAnalysisPrompt.js";
import { extractWritingStyleFeatures } from "./writingStyleFeatures.js";

export const WRITING_STYLE_QUALITY_VERSION = "style-quality.v2" as const;
export type WritingStyleSampleStatus = "accepted" | "weak" | "rejected";

/**
 * 评估样本质量。
 * @param content 样本文本
 * @param profile 样本特征画像
 * @returns 质量结论：usable 决定是否参与聚合，weight 参与聚合加权，warnings 说明降权原因
 */
export function assessWritingStyleSampleQuality(
  content: string,
  _profile: WritingStyleFeatureProfile,
  providedStats?: WritingStyleLocalStats
) {
  const trimmed = content.trim();
  const stats = providedStats ?? extractWritingStyleFeatures(trimmed, "sample.txt").localStats;
  const warnings: string[] = [];
  let detectedContentType: "narrative" | "script" | "essay" | "outline" | "metadata" | "unknown" = "unknown";
  // 判定只使用比例与正文证据；章节标题已经在特征层排除，不能再凭“超过 5 个章节”判为元数据。
  if (stats.bodyCharacterCount < 300) detectedContentType = "unknown";
  else if (stats.outlineLineRatio >= 0.35 && stats.proseCharacterRatio < 0.6) detectedContentType = "outline";
  else if (stats.metadataLineRatio >= 0.3 && stats.proseCharacterRatio < 0.6) detectedContentType = "metadata";
  else if (stats.speakerLineRatio >= 0.25 && stats.dialogueCharacterRatio >= 0.6) detectedContentType = "script";
  else if (stats.sentenceEndCount >= 3 && stats.proseCharacterRatio >= 0.5) detectedContentType = "narrative";

  let status: WritingStyleSampleStatus;
  let weight: number;
  if (detectedContentType === "outline" || detectedContentType === "metadata") {
    status = "rejected";
    weight = 0;
    warnings.push("样本主要由提纲或元数据构成，不参与正文风格聚合。");
  } else if (detectedContentType === "script") {
    status = "weak";
    weight = 0.5;
    warnings.push("样本更像剧本或角色台词稿，仅作为弱语义证据。");
  } else if (detectedContentType === "unknown") {
    status = "weak";
    weight = trimmed.length < 300 ? 0.3 : 0.4;
    warnings.push(trimmed.length < 300 ? "样本少于 300 字，只能作为弱证据。" : "正文类型证据不足，仅作为弱语义证据。");
  } else {
    weight = trimmed.length < 300 ? 0.3 : trimmed.length < 800 ? 0.6 : 1;
    status = weight >= 0.6 ? "accepted" : "weak";
    if (trimmed.length < 300) warnings.push("样本少于 300 字，只能作为弱证据。");
  }

  // 重复度使用 12 字长片段与完全重复段落；只有高覆盖重复才降级，正常长篇中的常用二字词不会触发。
  if (status !== "rejected" && (stats.repeated12GramRatio >= 0.45 || stats.duplicateParagraphRatio >= 0.5)) {
    status = "rejected";
    weight = 0;
    warnings.push("样本存在大面积重复片段或重复段落，已排除出风格分析。");
  } else if (status !== "rejected" && (stats.repeated12GramRatio >= 0.2 || stats.duplicateParagraphRatio >= 0.25)) {
    status = "weak";
    weight = Math.min(weight, 0.4);
    warnings.push("样本重复内容占比较高，仅作为弱语义证据。");
  } else if (status !== "rejected" && (stats.repeated12GramRatio >= 0.08 || stats.duplicateParagraphRatio >= 0.1)) {
    weight *= 0.8;
    if (status === "accepted" && weight < 0.6) status = "weak";
    warnings.push("样本含一定比例的重复内容，已适度降低统计权重。");
  }

  const diagnostics = {
    headingRatio: stats.headingRatio,
    outlineLineRatio: stats.outlineLineRatio,
    metadataLineRatio: stats.metadataLineRatio,
    proseLineRatio: stats.proseLineRatio,
    proseCharacterRatio: stats.proseCharacterRatio,
    speakerLineRatio: stats.speakerLineRatio,
    repeated12GramRatio: stats.repeated12GramRatio,
    duplicateParagraphRatio: stats.duplicateParagraphRatio,
    sampledCharacterCount: stats.repetitionSampledCharacterCount
  };
  return {
    qualityVersion: WRITING_STYLE_QUALITY_VERSION,
    status,
    // 兼容旧调用方：weak 仍可作为语义证据，只有 rejected 才完全不可用。
    usable: status !== "rejected",
    weight: Math.round(weight * 100) / 100,
    detectedContentType,
    warnings,
    diagnostics
  };
}

/** 兼容旧版 quality：把 usable/weight/type 映射为明确的三档状态。 */
export function resolveWritingStyleSampleStatus(quality: {
  status?: WritingStyleSampleStatus;
  usable: boolean;
  weight: number;
  detectedContentType: string;
}): WritingStyleSampleStatus {
  if (quality.status) return quality.status;
  if (!quality.usable) return "rejected";
  if (quality.weight < 0.5 || ["outline", "metadata", "unknown"].includes(quality.detectedContentType)) return "weak";
  return "accepted";
}

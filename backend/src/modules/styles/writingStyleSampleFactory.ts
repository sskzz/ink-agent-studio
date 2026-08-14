/**
 * 写作风格样本工厂。
 * 职责：从原始文本生成统一的样本元数据、v2 特征画像与质量结论；不负责读写和风格存在性校验。
 */
import { randomUUID } from "node:crypto";
import { hashStyleValue } from "./styleHash.js";
import { createWritingStyleFeatureProfile, extractWritingStyleFeatures, WRITING_STYLE_FEATURE_VERSION } from "./writingStyleFeatures.js";
import { assessWritingStyleSampleQuality } from "./writingStyleSampleQuality.js";

export function createWritingStyleSampleRecord(
  styleId: string,
  input: { fileName: string; content: string; role?: "seed" | "reference" }
) {
  const content = input.content.trim();
  const extracted = extractWritingStyleFeatures(content, input.fileName);
  const featureProfile = createWritingStyleFeatureProfile(extracted.localStats);
  const now = new Date().toISOString();
  const id = randomUUID();
  return {
    content,
    sample: {
      id,
      styleId,
      fileName: input.fileName,
      contentPath: `samples/${id}.txt`,
      contentHash: hashStyleValue(content),
      contentLength: content.length,
      featureVersion: WRITING_STYLE_FEATURE_VERSION,
      featureProfile,
      quality: assessWritingStyleSampleQuality(content, featureProfile, extracted.localStats),
      role: input.role ?? "reference" as const,
      createdAt: now,
      updatedAt: now
    }
  };
}

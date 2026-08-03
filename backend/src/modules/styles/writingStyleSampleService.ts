/**
 * 风格样本服务。
 * 职责：管理单个风格下的样本集合——增删与重新分析；新增时提取特征、评估质量并维护风格的样本计数；
 * 边界：写操作按风格粒度加锁；每风格样本上限 20 个、内容哈希去重；删除样本不自动重建版本（由用户显式触发）。
 */
import { randomUUID } from "node:crypto";
import { styleSampleCreateInputSchema } from "../../schemas/styleVersionSchemas.js";
import { badRequest } from "../../utils/errors.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { hashStyleValue } from "./styleHash.js";
import { createWritingStyleFeatureProfile, extractWritingStyleFeatures } from "./writingStyleFeatures.js";
import {
  deleteWritingStyleSampleFile,
  getWritingStyleSample,
  listWritingStyleSamples,
  saveWritingStyleSample
} from "./writingStyleRepository.js";
import { assessWritingStyleSampleQuality } from "./writingStyleSampleQuality.js";
import { getWritingStyle, updateWritingStyleRecord } from "./writingStyleService.js";
import { withWritingStyleLock } from "./writingStyleLock.js";

/** 每个风格最多保留的样本数，防止样本库无限膨胀。 */
const maxSamplesPerStyle = 20;

/** 列出风格样本；先校验风格存在。 */
export async function listStyleSamples(paths: WorkspacePaths, styleId: string) {
  await getWritingStyle(paths, styleId);
  return listWritingStyleSamples(paths, styleId);
}

/** 读取单个样本；不存在时抛 notFound。 */
export async function getStyleSample(paths: WorkspacePaths, styleId: string, sampleId: string) {
  await getWritingStyle(paths, styleId);
  return getWritingStyleSample(paths, styleId, sampleId);
}

/**
 * 新增样本：校验数量上限与内容去重后，提取特征、评估质量并持久化，最后更新风格的样本统计。
 * 新增样本会把风格状态置回 draft，因为新样本可能改变风格画像，需重新建版本。
 */
export async function addStyleSample(paths: WorkspacePaths, styleId: string, body: unknown) {
  return withWritingStyleLock(styleId, async () => {
  await getWritingStyle(paths, styleId);
  const input = styleSampleCreateInputSchema.parse(body);
  const samples = await listWritingStyleSamples(paths, styleId);
  if (samples.length >= maxSamplesPerStyle) throw badRequest(`每个写作风格最多保存 ${maxSamplesPerStyle} 个样本`);
  const content = input.content.trim();
  const contentHash = hashStyleValue(content);
  // 内容哈希去重：同一份文本不允许重复入库，避免样本互相污染画像
  if (samples.some((sample) => sample.contentHash === contentHash)) throw badRequest("相同内容的样本已经存在");
  const extracted = extractWritingStyleFeatures(content, input.fileName);
  const featureProfile = createWritingStyleFeatureProfile(extracted.localStats);
  const quality = assessWritingStyleSampleQuality(content, featureProfile);
  const now = new Date().toISOString();
  const id = randomUUID();
  const sample = {
    id,
    styleId,
    fileName: input.fileName,
    contentPath: `samples/${id}.txt`,
    contentHash,
    contentLength: content.length,
    featureVersion: "style-features.v1",
    featureProfile,
    quality,
    createdAt: now,
    updatedAt: now
  };
  await saveWritingStyleSample(paths, sample, content);
  const nextSamples = [sample, ...samples];
  await updateWritingStyleRecord(paths, styleId, {
    sampleCount: nextSamples.length,
    validSampleCount: nextSamples.filter((item) => item.quality.usable).length,
    status: "draft"
  });
  return sample;
  });
}

/** 删除样本：先删样本文件，再按剩余样本刷新计数；样本删除后版本需重建才生效。 */
export async function removeStyleSample(paths: WorkspacePaths, styleId: string, sampleId: string) {
  return withWritingStyleLock(styleId, async () => {
  await getWritingStyle(paths, styleId);
  await deleteWritingStyleSampleFile(paths, styleId, sampleId);
  const samples = await listWritingStyleSamples(paths, styleId);
  await updateWritingStyleRecord(paths, styleId, {
    sampleCount: samples.length,
    validSampleCount: samples.filter((item) => item.quality.usable).length,
    status: "draft"
  });
  return { id: sampleId, deleted: true };
  });
}

/** 用当前特征提取版本重新分析样本：只重算特征与质量，不修改样本内容。 */
export async function reanalyzeStyleSample(paths: WorkspacePaths, styleId: string, sampleId: string) {
  return withWritingStyleLock(styleId, async () => {
  const current = await getWritingStyleSample(paths, styleId, sampleId);
  const extracted = extractWritingStyleFeatures(current.content, current.fileName);
  const featureProfile = createWritingStyleFeatureProfile(extracted.localStats);
  const updated = {
    ...current,
    featureVersion: "style-features.v1",
    featureProfile,
    quality: assessWritingStyleSampleQuality(current.content, featureProfile),
    updatedAt: new Date().toISOString()
  };
  const { content, ...metadata } = updated;
  await saveWritingStyleSample(paths, metadata, content);
  await updateWritingStyleRecord(paths, styleId, { status: "draft" });
  return metadata;
  });
}

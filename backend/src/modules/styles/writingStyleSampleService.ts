/**
 * 风格样本服务。
 * 职责：管理单个风格下的样本集合——增删与重新分析；新增时提取特征、评估质量并维护风格的样本计数；
 * 边界：写操作按风格粒度加锁；每风格样本上限 20 个、内容哈希去重；删除样本不自动重建版本（由用户显式触发）。
 */
import { styleSampleCreateInputSchema } from "../../schemas/styleVersionSchemas.js";
import { badRequest } from "../../utils/errors.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { createWritingStyleFeatureProfile, extractWritingStyleFeatures, WRITING_STYLE_FEATURE_VERSION } from "./writingStyleFeatures.js";
import {
  deleteWritingStyleSampleFile,
  getWritingStyleSample,
  listWritingStyleSamples,
  saveWritingStyleSample
} from "./writingStyleRepository.js";
import { assessWritingStyleSampleQuality, resolveWritingStyleSampleStatus, WRITING_STYLE_QUALITY_VERSION } from "./writingStyleSampleQuality.js";
import { getWritingStyle, updateWritingStyleRecord } from "./writingStyleService.js";
import { withWritingStyleLock } from "./writingStyleLock.js";
import { createWritingStyleSampleRecord } from "./writingStyleSampleFactory.js";

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
  const { content, sample } = createWritingStyleSampleRecord(styleId, { ...input, role: "reference" });
  // 内容哈希去重：同一份文本不允许重复入库，避免样本互相污染画像
  if (samples.some((item) => item.contentHash === sample.contentHash)) throw badRequest("相同内容的样本已经存在");
  await saveWritingStyleSample(paths, sample, content);
  const nextSamples = [sample, ...samples];
  await updateWritingStyleRecord(paths, styleId, {
    sampleCount: nextSamples.length,
    validSampleCount: nextSamples.filter((item) => resolveWritingStyleSampleStatus(item.quality) === "accepted").length,
    status: "draft"
  });
  return sample;
  });
}

/** 删除样本：先删样本文件，再按剩余样本刷新计数；样本删除后版本需重建才生效。 */
export async function removeStyleSample(paths: WorkspacePaths, styleId: string, sampleId: string) {
  return withWritingStyleLock(styleId, async () => {
  const style = await getWritingStyle(paths, styleId);
  await deleteWritingStyleSampleFile(paths, styleId, sampleId);
  const samples = await listWritingStyleSamples(paths, styleId);
  await updateWritingStyleRecord(paths, styleId, {
    sampleCount: samples.length,
    validSampleCount: samples.filter((item) => resolveWritingStyleSampleStatus(item.quality) === "accepted").length,
    status: "draft",
    ...(style.seedSampleId === sampleId ? { seedSampleId: null, sampleFileName: null } : {})
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
    featureVersion: WRITING_STYLE_FEATURE_VERSION,
    featureProfile,
    quality: assessWritingStyleSampleQuality(current.content, featureProfile, extracted.localStats),
    updatedAt: new Date().toISOString()
  };
  const { content, ...metadata } = updated;
  await saveWritingStyleSample(paths, metadata, content);
  const samples = await listWritingStyleSamples(paths, styleId);
  await updateWritingStyleRecord(paths, styleId, {
    sampleCount: samples.length,
    validSampleCount: samples.filter((item) => resolveWritingStyleSampleStatus(item.quality) === "accepted").length,
    status: "draft"
  });
  return metadata;
  });
}

/** 批量重新质检全部样本；用于质量规则升级和重建前自动刷新旧特征。 */
export async function reanalyzeStyleSamples(paths: WorkspacePaths, styleId: string) {
  return withWritingStyleLock(styleId, async () => {
    await getWritingStyle(paths, styleId);
    const updated = await refreshOutdatedStyleSamples(paths, styleId);
    await updateWritingStyleRecord(paths, styleId, {
      sampleCount: updated.length,
      validSampleCount: updated.filter((item) => resolveWritingStyleSampleStatus(item.quality) === "accepted").length,
      status: "draft"
    });
    return updated;
  });
}

/** 重建已持有风格锁时调用：只升级过期样本，不再次加锁或修改风格状态。 */
export async function refreshOutdatedStyleSamples(paths: WorkspacePaths, styleId: string) {
  const style = await getWritingStyle(paths, styleId);
  const samples = await listWritingStyleSamples(paths, styleId);
  const updated = [];
  for (const sample of samples) {
    if (sample.featureVersion === WRITING_STYLE_FEATURE_VERSION && sample.quality.qualityVersion === WRITING_STYLE_QUALITY_VERSION) {
      updated.push(sample);
      continue;
    }
    const current = await getWritingStyleSample(paths, styleId, sample.id);
    const extracted = extractWritingStyleFeatures(current.content, current.fileName);
    const featureProfile = createWritingStyleFeatureProfile(extracted.localStats);
    const metadata = {
      ...sample,
      featureVersion: WRITING_STYLE_FEATURE_VERSION,
      featureProfile,
      quality: assessWritingStyleSampleQuality(current.content, featureProfile, extracted.localStats),
      updatedAt: new Date().toISOString()
    };
    await saveWritingStyleSample(paths, metadata, current.content);
    updated.push(metadata);
  }
  // 兼容多样本功能上线后的旧记录：若初始文件名能在样本库中找到，将其补标为 seed，而不是继续显示成“正文缺失”。
  const seedCandidate = style.seedSampleId
    ? updated.find((sample) => sample.id === style.seedSampleId)
    : style.sampleFileName
      ? [...updated].sort((left, right) => left.createdAt.localeCompare(right.createdAt)).find((sample) => sample.fileName === style.sampleFileName)
      : undefined;
  if (seedCandidate && (seedCandidate.role !== "seed" || style.seedSampleId !== seedCandidate.id)) {
    if (seedCandidate.role !== "seed") {
      const current = await getWritingStyleSample(paths, styleId, seedCandidate.id);
      const metadata = { ...seedCandidate, role: "seed" as const, updatedAt: new Date().toISOString() };
      await saveWritingStyleSample(paths, metadata, current.content);
      const index = updated.findIndex((sample) => sample.id === seedCandidate.id);
      if (index >= 0) updated[index] = metadata;
    }
    await updateWritingStyleRecord(paths, styleId, { seedSampleId: seedCandidate.id });
  }
  return updated;
}

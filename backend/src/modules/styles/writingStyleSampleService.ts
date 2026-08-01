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

const maxSamplesPerStyle = 20;

export async function listStyleSamples(paths: WorkspacePaths, styleId: string) {
  await getWritingStyle(paths, styleId);
  return listWritingStyleSamples(paths, styleId);
}

export async function getStyleSample(paths: WorkspacePaths, styleId: string, sampleId: string) {
  await getWritingStyle(paths, styleId);
  return getWritingStyleSample(paths, styleId, sampleId);
}

export async function addStyleSample(paths: WorkspacePaths, styleId: string, body: unknown) {
  return withWritingStyleLock(styleId, async () => {
  await getWritingStyle(paths, styleId);
  const input = styleSampleCreateInputSchema.parse(body);
  const samples = await listWritingStyleSamples(paths, styleId);
  if (samples.length >= maxSamplesPerStyle) throw badRequest(`每个写作风格最多保存 ${maxSamplesPerStyle} 个样本`);
  const content = input.content.trim();
  const contentHash = hashStyleValue(content);
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

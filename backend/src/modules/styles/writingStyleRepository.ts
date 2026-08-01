import type { z } from "zod";
import {
  styleSamplesIndexSchema,
  styleVersionsIndexSchema,
  writingStyleSampleSchema,
  writingStyleVersionSchema,
  type WritingStyleSample,
  type WritingStyleVersion
} from "../../schemas/styleVersionSchemas.js";
import { writingStyleRecordSchema } from "../../schemas/styleSchemas.js";
import { ensureDirectory, pathExists, readTextFile, writeTextFileAtomic } from "../../utils/fileStore.js";
import { readJsonFile, writeJsonFile } from "../../utils/jsonStore.js";
import { notFound } from "../../utils/errors.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { createWritingStylePaths } from "./writingStylePaths.js";
import { createConstraintResolutionTrace } from "../constraints/constraintResolver.js";

type WritingStyleRecord = z.infer<typeof writingStyleRecordSchema>;

export async function ensureWritingStyleDirectories(paths: WorkspacePaths, styleId: string) {
  const stylePaths = createWritingStylePaths(paths, styleId);
  await Promise.all([
    ensureDirectory(stylePaths.styleDir),
    ensureDirectory(stylePaths.samplesDir),
    ensureDirectory(stylePaths.versionsDir),
    ensureDirectory(stylePaths.compiledDir)
  ]);
  await Promise.all([
    readJsonFile(stylePaths.samplesIndexFile, styleSamplesIndexSchema, []),
    readJsonFile(stylePaths.versionsIndexFile, styleVersionsIndexSchema, [])
  ]);
  return stylePaths;
}

export async function syncWritingStyleDetail(paths: WorkspacePaths, style: WritingStyleRecord) {
  const stylePaths = await ensureWritingStyleDirectories(paths, style.id);
  await writeJsonFile(stylePaths.styleFile, style);
}

export async function listWritingStyleSamples(paths: WorkspacePaths, styleId: string) {
  const stylePaths = await ensureWritingStyleDirectories(paths, styleId);
  return readJsonFile(stylePaths.samplesIndexFile, styleSamplesIndexSchema, []);
}

export async function getWritingStyleSample(paths: WorkspacePaths, styleId: string, sampleId: string) {
  const samples = await listWritingStyleSamples(paths, styleId);
  const sample = samples.find((item) => item.id === sampleId);
  if (!sample) throw notFound("写作风格样本不存在", { styleId, sampleId });
  const stylePaths = createWritingStylePaths(paths, styleId);
  return { ...sample, content: await readTextFile(stylePaths.sampleContentFile(sampleId)) };
}

export async function saveWritingStyleSample(
  paths: WorkspacePaths,
  sample: WritingStyleSample,
  content: string
) {
  const stylePaths = await ensureWritingStyleDirectories(paths, sample.styleId);
  const samples = await readJsonFile(stylePaths.samplesIndexFile, styleSamplesIndexSchema, []);
  const next = samples.some((item) => item.id === sample.id)
    ? samples.map((item) => (item.id === sample.id ? sample : item))
    : [sample, ...samples];
  await Promise.all([
    writeJsonFile(stylePaths.samplesIndexFile, next),
    writeJsonFile(stylePaths.sampleMetadataFile(sample.id), writingStyleSampleSchema.parse(sample)),
    writeTextFileAtomic(stylePaths.sampleContentFile(sample.id), content)
  ]);
  return sample;
}

export async function deleteWritingStyleSampleFile(paths: WorkspacePaths, styleId: string, sampleId: string) {
  const stylePaths = await ensureWritingStyleDirectories(paths, styleId);
  const samples = await readJsonFile(stylePaths.samplesIndexFile, styleSamplesIndexSchema, []);
  if (!samples.some((item) => item.id === sampleId)) throw notFound("写作风格样本不存在", { styleId, sampleId });
  await writeJsonFile(stylePaths.samplesIndexFile, samples.filter((item) => item.id !== sampleId));
  // 原始文件保留，已有不可变版本仍可通过哈希追踪；清理交由未来垃圾回收任务处理。
}

export async function listWritingStyleVersions(paths: WorkspacePaths, styleId: string) {
  const stylePaths = await ensureWritingStyleDirectories(paths, styleId);
  return readJsonFile(stylePaths.versionsIndexFile, styleVersionsIndexSchema, []);
}

export async function getWritingStyleVersion(paths: WorkspacePaths, styleId: string, versionId: string) {
  const stylePaths = await ensureWritingStyleDirectories(paths, styleId);
  if (!(await pathExists(stylePaths.versionFile(versionId)))) {
    throw notFound("写作风格版本不存在", { styleId, versionId });
  }
  return readJsonFile(stylePaths.versionFile(versionId), writingStyleVersionSchema, {} as WritingStyleVersion);
}

export async function saveWritingStyleVersion(paths: WorkspacePaths, version: WritingStyleVersion) {
  const parsed = writingStyleVersionSchema.parse(version);
  const stylePaths = await ensureWritingStyleDirectories(paths, version.styleId);
  if (await pathExists(stylePaths.versionFile(version.id))) {
    return getWritingStyleVersion(paths, version.styleId, version.id);
  }
  const versions = await readJsonFile(stylePaths.versionsIndexFile, styleVersionsIndexSchema, []);
  const indexRecord = {
    id: version.id,
    styleId: version.styleId,
    styleHash: version.styleHash,
    sampleCount: version.sampleIds.length,
    confidence: version.aggregateProfile.confidence,
    status: version.aggregateProfile.status,
    createdAt: version.createdAt
  } as const;
  await Promise.all([
    writeJsonFile(stylePaths.versionFile(version.id), parsed),
    writeJsonFile(stylePaths.versionsIndexFile, [indexRecord, ...versions])
  ]);
  return parsed;
}

export async function cacheCompiledStyleConstraint(
  paths: WorkspacePaths,
  styleId: string,
  constraintHash: string,
  compiled: unknown
) {
  const stylePaths = await ensureWritingStyleDirectories(paths, styleId);
  if (!(await pathExists(stylePaths.compiledFile(constraintHash)))) {
    const value = compiled && typeof compiled === "object" && "resolution" in compiled
      ? { ...compiled, resolution: createConstraintResolutionTrace((compiled as { resolution: Parameters<typeof createConstraintResolutionTrace>[0] }).resolution) }
      : compiled;
    await writeJsonFile(stylePaths.compiledFile(constraintHash), value);
  }
  return compiled;
}

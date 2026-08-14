/**
 * 写作风格仓储层。
 * 职责：管理风格详情的磁盘布局——样本/版本/编译缓存三类索引文件与内容文件，提供增删改查；
 * 边界：不包含业务规则（校验在上层 service）；版本文件按内容寻址保存、写入幂等；删除样本只移出索引、保留原文件以支持历史哈希追踪。
 */
import type { z } from "zod";
import { rm } from "node:fs/promises";
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

/** 确保风格目录结构存在并初始化空索引，返回路径集合。 */
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

/** 把风格记录同步写为 style.json（索引与详情保持一致）。 */
export async function syncWritingStyleDetail(paths: WorkspacePaths, style: WritingStyleRecord) {
  const stylePaths = await ensureWritingStyleDirectories(paths, style.id);
  await writeJsonFile(stylePaths.styleFile, style);
}

/** 列出风格全部样本（仅索引元数据，不含正文）。 */
export async function listWritingStyleSamples(paths: WorkspacePaths, styleId: string) {
  const stylePaths = await ensureWritingStyleDirectories(paths, styleId);
  return readJsonFile(stylePaths.samplesIndexFile, styleSamplesIndexSchema, []);
}

/** 读取样本元数据与正文；样本不存在时抛 notFound。 */
export async function getWritingStyleSample(paths: WorkspacePaths, styleId: string, sampleId: string) {
  const samples = await listWritingStyleSamples(paths, styleId);
  const sample = samples.find((item) => item.id === sampleId);
  if (!sample) throw notFound("写作风格样本不存在", { styleId, sampleId });
  const stylePaths = createWritingStylePaths(paths, styleId);
  return { ...sample, content: await readTextFile(stylePaths.sampleContentFile(sampleId)) };
}

/** 保存样本：更新索引、样本元数据文件与正文文件（原子写），新建样本置于索引头部。 */
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

/** 永久删除一个风格的完整目录，包括样本正文、版本文件与编译缓存。 */
export async function deleteWritingStyleStorage(paths: WorkspacePaths, styleId: string) {
  const stylePaths = createWritingStylePaths(paths, styleId);
  await rm(stylePaths.styleDir, { recursive: true, force: true });
}

/** 列出风格全部版本（索引记录）。 */
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

/** 保存版本：版本文件按 id 内容寻址，已存在则直接返回（幂等），并更新版本索引。 */
export async function saveWritingStyleVersion(paths: WorkspacePaths, version: WritingStyleVersion) {
  const parsed = writingStyleVersionSchema.parse(version);
  const stylePaths = await ensureWritingStyleDirectories(paths, version.styleId);
  // 内容寻址幂等：同一 id 版本不重复写入
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

/**
 * 缓存编译后的风格约束（按 constraintHash 内容寻址）。
 * resolution 字段先转成可序列化追踪记录再落盘，避免保存解析器内部对象。
 */
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

/**
 * 写作风格迁移。
 * 职责：把旧版（v3/v1 单样本）风格懒迁移为不可变版本（writing-style-version.v1），并在工作区启动时批量执行；
 * 边界：迁移只增不改——旧字段全部保留保证旧前端兼容；迁移版本标记为 degraded，提示用户补充样本后重建。
 */
import type { z } from "zod";
import { writingStyleRecordSchema } from "../../schemas/styleSchemas.js";
import type { AggregateStyleProfile, WritingStyleVersion } from "../../schemas/styleVersionSchemas.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { hashStyleValue } from "./styleHash.js";
import { saveWritingStyleVersion, syncWritingStyleDetail } from "./writingStyleRepository.js";
import { writingStylesIndexSchema } from "../../schemas/styleSchemas.js";
import { readJsonFile, writeJsonFile } from "../../utils/jsonStore.js";

type WritingStyleRecord = z.infer<typeof writingStyleRecordSchema>;

/** 将已有 v3/v1 风格懒迁移为首个不可变版本；不删除旧字段，确保旧前端继续读取。
 * 已迁移（latestVersionId 存在）或无 analysis 的风格原样返回。 */
export async function migrateLegacyWritingStyle(paths: WorkspacePaths, style: WritingStyleRecord) {
  if (style.latestVersionId || !style.analysis) return style;
  const aggregateProfile = createLegacyAggregateProfile(style);
  const core = {
    styleId: style.id,
    schemaVersion: "writing-style-version.v1" as const,
    analysisVersion: style.analysis.schemaVersion,
    featureVersion: style.featureProfile?.schemaVersion ?? "none",
    aggregationVersion: "style-aggregate.v1",
    compilerVersion: "style-compiler.v2",
    sampleIds: [],
    sampleHashes: [],
    aggregateProfile,
    semanticProfile: style.analysis,
    constraintPolicy: {
      strongMetricStability: 0.75,
      softMetricStability: 0.45,
      maxAutomaticRevisions: 1,
      invariantRuleIds: []
    }
  };
  const styleHash = hashStyleValue(core);
  const version: WritingStyleVersion = {
    ...core,
    id: `legacy-${styleHash.slice(0, 20)}`,
    styleHash,
    createdAt: style.updatedAt
  };
  await saveWritingStyleVersion(paths, version);
  const migrated = {
    ...style,
    latestVersionId: version.id,
    sampleCount: style.sampleCount ?? 0,
    validSampleCount: style.validSampleCount ?? 0,
    status: "degraded" as const
  };
  await syncWritingStyleDetail(paths, migrated);
  return migrated;
}

/** 工作区启动阶段执行迁移；普通列表和详情读取不得调用（只迁移有变化的风格并回写索引）。 */
export async function migrateWritingStyleStorage(paths: WorkspacePaths) {
  const styles = await readJsonFile(paths.writingStylesFile, writingStylesIndexSchema, []);
  const migrated = [];
  let changed = false;
  for (const style of styles) {
    const next = await migrateLegacyWritingStyle(paths, style);
    migrated.push(next);
    if (next.latestVersionId !== style.latestVersionId) changed = true;
  }
  if (changed) await writeJsonFile(paths.writingStylesFile, migrated);
  return { changed, migratedCount: migrated.filter((style, index) => style.latestVersionId !== styles[index]?.latestVersionId).length };
}

/** 用旧版单样本特征构造退化聚合画像：无标准差信息，容差按度量类型估算，稳定度固定 0.2（低置信，防止误当强约束）。 */
function createLegacyAggregateProfile(style: WritingStyleRecord): AggregateStyleProfile {
  const metrics: AggregateStyleProfile["metrics"] = {};
  for (const [metric, value] of Object.entries(style.featureProfile?.metrics ?? {})) {
    // 比例类度量用固定 0.15 容差，其余按值的 40%（下限 2）估算区间
    const tolerance = metric.toLowerCase().includes("ratio") ? 0.15 : Math.max(2, Math.abs(value) * 0.4);
    metrics[metric] = {
      metric,
      weightedMean: value,
      median: value,
      standardDeviation: 0,
      mad: 0,
      preferredMin: Math.max(0, value - tolerance),
      preferredMax: value + tolerance,
      stability: 0.2,
      validSampleCount: 1,
      outlierSampleIds: []
    };
  }
  return {
    schemaVersion: "style-aggregate.v1",
    sampleCount: 0,
    validSampleCount: 0,
    totalContentLength: style.featureProfile?.sourceContentLength ?? 0,
    confidence: Math.min(39, style.analysis?.parameters.confidence ?? 20),
    status: "degraded",
    metrics,
    acceptedSampleIds: [],
    weakSampleIds: [],
    rejectedSampleIds: [],
    warnings: ["该版本由旧版单样本风格迁移生成，建议补充至少 3 篇样本后重建。"]
  };
}

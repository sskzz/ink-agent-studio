import type { z } from "zod";
import { writingStyleRecordSchema } from "../../schemas/styleSchemas.js";
import type { AggregateStyleProfile, WritingStyleVersion } from "../../schemas/styleVersionSchemas.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { hashStyleValue } from "./styleHash.js";
import { saveWritingStyleVersion, syncWritingStyleDetail } from "./writingStyleRepository.js";
import { writingStylesIndexSchema } from "../../schemas/styleSchemas.js";
import { readJsonFile, writeJsonFile } from "../../utils/jsonStore.js";

type WritingStyleRecord = z.infer<typeof writingStyleRecordSchema>;

/** 将已有 v3/v1 风格懒迁移为首个不可变版本；不删除旧字段，确保旧前端继续读取。 */
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

/** 工作区启动阶段执行迁移；普通列表和详情读取不得调用。 */
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

function createLegacyAggregateProfile(style: WritingStyleRecord): AggregateStyleProfile {
  const metrics: AggregateStyleProfile["metrics"] = {};
  for (const [metric, value] of Object.entries(style.featureProfile?.metrics ?? {})) {
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

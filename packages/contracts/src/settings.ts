import { z } from "zod";

const retryConfigSchema = z.object({
  maxAttemptsPerModel: z.number().int().min(1).max(10),
  maxTotalAttempts: z.number().int().min(1).max(20),
  baseDelayMs: z.number().int().min(0).max(60_000),
  maxDelayMs: z.number().int().min(0).max(300_000)
}).strict();

const contextBudgetsSchema = z.object({
  stableMaxTokens: z.number().int().positive(),
  factsMaxTokens: z.number().int().positive(),
  sceneMaxTokens: z.number().int().positive(),
  recentMaxTokens: z.number().int().positive(),
  sessionMaxTokens: z.number().int().positive(),
  skillsMaxTokens: z.number().int().positive(),
  turnMinTokens: z.number().int().positive()
}).strict();

export const appConfigSectionsSchema = z.object({
  general: z.object({
    locale: z.string().min(1),
    autosaveIntervalMs: z.number().int().min(1_000).max(3_600_000)
  }).strict(),
  runtime: z.object({
    globalConcurrency: z.number().int().min(1).max(32),
    perBookMutationConcurrency: z.number().int().min(1).max(8),
    queueLimit: z.number().int().min(1).max(10_000),
    shutdownGraceMs: z.number().int().min(1_000).max(300_000)
  }).strict(),
  events: z.object({
    heartbeatMs: z.number().int().min(1_000).max(120_000),
    streamBatchIntervalMs: z.number().int().min(10).max(10_000),
    streamBatchCharacters: z.number().int().min(128).max(65_536),
    replayLimit: z.number().int().min(1).max(100_000),
    inlinePayloadMaxBytes: z.number().int().min(1_024).max(1_048_576)
  }).strict(),
  models: z.object({
    defaultTimeoutMs: z.number().int().min(1_000).max(900_000),
    retry: retryConfigSchema
  }).strict(),
  context: z.object({
    defaultContextWindow: z.number().int().min(4_096),
    defaultMaxOutputTokens: z.number().int().min(256),
    safetyMarginRatio: z.number().min(0.01).max(0.5),
    compressionThresholdRatio: z.number().min(0.5).max(0.95),
    budgets: contextBudgetsSchema
  }).strict(),
  sessions: z.object({
    searchResultLimit: z.number().int().min(1).max(200),
    searchSnippetCharacters: z.number().int().min(50).max(5_000),
    recentMessageLimit: z.number().int().min(1).max(500)
  }).strict(),
  patches: z.object({
    approvalRequired: z.literal(true),
    keepBeforeApplyBackup: z.boolean()
  }).strict(),
  memory: z.object({
    enabled: z.boolean(),
    writeApprovalRequired: z.literal(true),
    promptTokenBudget: z.number().int().min(128).max(16_000),
    maxActiveEntries: z.number().int().min(1).max(1_000)
  }).strict(),
  skills: z.object({
    enabled: z.boolean(),
    writeApprovalRequired: z.boolean(),
    maxLoadedSkills: z.number().int().min(1).max(20),
    promptTokenBudget: z.number().int().min(128).max(32_000)
  }).strict(),
  storage: z.object({
    sqliteBusyTimeoutMs: z.number().int().min(100).max(120_000),
    backupBeforeMigration: z.boolean(),
    automaticPruning: z.literal(false)
  }).strict(),
  plugins: z.object({ enabled: z.boolean() }).strict(),
  mcp: z.object({ enabled: z.boolean() }).strict(),
  cron: z.object({
    enabled: z.boolean(),
    timezone: z.string().min(1),
    maxConcurrentJobs: z.number().int().min(1).max(32),
    misfirePolicy: z.enum(["skip", "run_once", "bounded_catch_up"])
  }).strict(),
  features: z.object({
    asyncRuns: z.boolean(),
    agentLoop: z.boolean(),
    patchApply: z.boolean(),
    skills: z.boolean(),
    plugins: z.boolean(),
    mcp: z.boolean(),
    cron: z.boolean()
  }).strict()
}).strict();

export const appConfigSchema = appConfigSectionsSchema.extend({
  schemaVersion: z.literal("app-config.v1"),
  revision: z.number().int().positive()
}).strict();

export const appConfigPatchSchema = z.object({
  expectedRevision: z.number().int().positive(),
  changes: appConfigSectionsSchema.deepPartial()
}).strict();

export type AppConfig = z.infer<typeof appConfigSchema>;
export type AppConfigSections = z.infer<typeof appConfigSectionsSchema>;
export type AppConfigPatch = z.infer<typeof appConfigPatchSchema>;

export interface EffectiveConfigResponse {
  effectiveConfig: AppConfig;
  revision: number;
  configHash: string;
  sources: Record<string, "default" | "file" | "environment">;
  lockedFields: string[];
  restartRequiredFields: string[];
}

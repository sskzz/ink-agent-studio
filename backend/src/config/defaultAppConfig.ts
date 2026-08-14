import type { AppConfig } from "@ink-agent/contracts";

/**
 * 默认公共配置。
 * 首次启动时写入 app-config.json；config/app-config.example.json 必须与它保持一致（有测试守护）。
 */
export const defaultAppConfig = {
  schemaVersion: "app-config.v1",
  revision: 1,
  general: {
    locale: "zh-CN",
    autosaveIntervalMs: 30_000
  },
  runtime: {
    globalConcurrency: 2,
    perBookMutationConcurrency: 1,
    queueLimit: 50,
    shutdownGraceMs: 10_000
  },
  events: {
    heartbeatMs: 15_000,
    streamBatchIntervalMs: 500,
    streamBatchCharacters: 2_048,
    replayLimit: 5_000,
    inlinePayloadMaxBytes: 32_768
  },
  models: {
    defaultTimeoutMs: 90_000,
    retry: {
      maxAttemptsPerModel: 2,
      maxTotalAttempts: 4,
      baseDelayMs: 500,
      maxDelayMs: 5_000
    }
  },
  context: {
    defaultContextWindow: 32_768,
    defaultMaxOutputTokens: 4_096,
    safetyMarginRatio: 0.1,
    compressionThresholdRatio: 0.7,
    // 默认定向注入：facts 层只装配本章相关实体/伏笔/状态与核心基线，显著缩小 prompt
    retrievalMode: "targeted",
    budgets: {
      stableMaxTokens: 4_000,
      factsMaxTokens: 8_000,
      sceneMaxTokens: 6_000,
      recentMaxTokens: 8_000,
      sessionMaxTokens: 4_000,
      skillsMaxTokens: 4_000,
      turnMinTokens: 1_000
    }
  },
  sessions: {
    searchResultLimit: 20,
    searchSnippetCharacters: 300,
    recentMessageLimit: 30
  },
  patches: {
    approvalRequired: true,
    keepBeforeApplyBackup: true
  },
  memory: {
    enabled: true,
    writeApprovalRequired: true,
    promptTokenBudget: 1_200,
    maxActiveEntries: 50,
    embedding: {
      enabled: true,
      provider: "local-bge-small-zh",
      modelId: "Xenova/bge-small-zh-v1.5",
      dimensions: 512,
      autoDownload: false,
      candidateLimit: 1_000
    }
  },
  skills: {
    enabled: true,
    writeApprovalRequired: true,
    maxLoadedSkills: 5,
    promptTokenBudget: 4_000
  },
  storage: {
    sqliteBusyTimeoutMs: 5_000,
    backupBeforeMigration: true,
    automaticPruning: false
  },
  plugins: { enabled: false },
  mcp: { enabled: false },
  cron: {
    enabled: false,
    timezone: "Asia/Shanghai",
    maxConcurrentJobs: 1,
    misfirePolicy: "run_once"
  },
  features: {
    asyncRuns: true,
    agentLoop: false,
    patchApply: false,
    skills: true,
    plugins: false,
    mcp: false,
    cron: false
  }
} satisfies AppConfig;

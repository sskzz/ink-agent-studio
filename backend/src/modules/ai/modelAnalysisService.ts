import type { ModelConfigRecord, ModelRouteRecord } from "../../types/domain.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { getModelRoutes, listModelConfigs } from "../models/modelConfigRepository.js";
import { hasModelProviderAdapter } from "./modelGateway.js";

type AnalysisSeverity = "info" | "warning" | "critical";
type AnalysisStatus = "ready" | "partial" | "blocked";
type RouteKey = keyof ModelRouteRecord;

interface AnalysisIssue {
  id: string;
  severity: AnalysisSeverity;
  title: string;
  description: string;
  targetId: string | null;
  targetType: "config" | "route" | "system";
}

interface RouteAnalysis {
  routeKey: RouteKey;
  label: string;
  modelConfigId: string | null;
  modelName: string;
  provider: string;
  ready: boolean;
  issues: string[];
}

const routeLabels: Record<RouteKey, string> = {
  writingModelId: "写作模型",
  reviewModelId: "审稿模型",
  planningModelId: "规划模型"
};

function createIssue(
  severity: AnalysisSeverity,
  title: string,
  description: string,
  targetType: AnalysisIssue["targetType"],
  targetId: string | null = null
): AnalysisIssue {
  return {
    id: `${targetType}-${targetId ?? "global"}-${title}`,
    severity,
    title,
    description,
    targetId,
    targetType
  };
}

function countBy<T extends string>(configs: ModelConfigRecord[], field: (config: ModelConfigRecord) => T) {
  const stats = new Map<T, { enabled: number; total: number }>();

  for (const config of configs) {
    const key = field(config);
    const current = stats.get(key) ?? { enabled: 0, total: 0 };
    stats.set(key, {
      enabled: current.enabled + (config.enabled ? 1 : 0),
      total: current.total + 1
    });
  }

  return Array.from(stats.entries()).map(([key, value]) => ({
    key,
    ...value
  }));
}

function isBlank(value: string) {
  return value.trim().length === 0;
}

function analyzeConfig(config: ModelConfigRecord): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];

  if (!config.enabled) {
    issues.push(
      createIssue("warning", "模型配置已停用", `「${config.name}」不会被 Agent 路由使用。`, "config", config.id)
    );
  }

  if (isBlank(config.name) || isBlank(config.baseUrl) || isBlank(config.apiModel)) {
    issues.push(
      createIssue(
        "critical",
        "模型配置字段不完整",
        `「${config.name || config.id}」缺少配置名称、Base URL 或 API 调用模型。`,
        "config",
        config.id
      )
    );
  }

  if (!hasModelProviderAdapter(config.provider)) {
    issues.push(
      createIssue(
        "info",
        "连接测试适配器未实现",
        `「${config.name}」的服务商 ${config.provider} 可以保存，但当前后端尚未实现连接测试 adapter。`,
        "config",
        config.id
      )
    );
  }

  return issues;
}

function analyzeRoute(routeKey: RouteKey, routes: ModelRouteRecord, configs: ModelConfigRecord[]): RouteAnalysis {
  const modelConfigId = routes[routeKey];
  const config = modelConfigId ? configs.find((item) => item.id === modelConfigId) : null;
  const issues: string[] = [];
  if (!modelConfigId) {
    issues.push(`${routeLabels[routeKey]}尚未指定模型。`);
  } else if (!config) {
    issues.push(`${routeLabels[routeKey]}指向的模型配置不存在。`);
  } else {
    if (!config.enabled) {
      issues.push(`${routeLabels[routeKey]}指向的模型已停用。`);
    }

  }

  return {
    routeKey,
    label: routeLabels[routeKey],
    modelConfigId,
    modelName: config?.name ?? "未设置",
    provider: config?.provider ?? "none",
    ready: issues.length === 0,
    issues
  };
}

function scoreIssues(issues: AnalysisIssue[], routes: RouteAnalysis[]) {
  const routePenalty = routes.reduce((sum, route) => sum + (route.ready ? 0 : route.routeKey === "planningModelId" ? 8 : 16), 0);
  const issuePenalty = issues.reduce((sum, issue) => {
    if (issue.severity === "critical") {
      return sum + 22;
    }

    if (issue.severity === "warning") {
      return sum + 8;
    }

    return sum + 2;
  }, 0);

  return Math.max(0, Math.min(100, 100 - routePenalty - issuePenalty));
}

function toStatus(score: number, issues: AnalysisIssue[]): AnalysisStatus {
  if (issues.some((issue) => issue.severity === "critical") || score < 55) {
    return "blocked";
  }

  if (score < 80 || issues.some((issue) => issue.severity === "warning")) {
    return "partial";
  }

  return "ready";
}

function createSuggestions(configs: ModelConfigRecord[], routes: RouteAnalysis[], issues: AnalysisIssue[]) {
  const suggestions = new Set<string>();

  if (configs.length === 0) {
    suggestions.add("先新增至少一个写作模型和一个审稿模型，再配置模型路由。");
  }

  for (const route of routes) {
    if (!route.ready) {
      suggestions.add(`补齐${route.label}路由，确保它指向已启用且用途匹配的模型。`);
    }
  }

  if (!configs.some((config) => config.enabled && config.purpose === "writing")) {
    suggestions.add("新增或启用一个用途为“写作”的模型，用于正文生成和章节续写。");
  }

  if (!configs.some((config) => config.enabled && config.purpose === "review")) {
    suggestions.add("新增或启用一个用途为“审稿”的模型，用于一致性检查、去 AI 味和质量评估。");
  }

  if (!configs.some((config) => config.enabled && config.purpose === "planning")) {
    suggestions.add("新增或启用一个用途为“规划”的模型，用于作品初始化、世界观角色设定、卷纲拆解和伏笔规划。");
  }

  if (issues.some((issue) => issue.title === "连接测试适配器未实现")) {
    suggestions.add("三方中转站优先使用 OpenAI Compatible / One API / LiteLLM 兼容配置，方便复用统一 adapter。");
  }

  if (issues.length === 0 && routes.every((route) => route.ready)) {
    suggestions.add("当前模型配置已具备第一版写作和审稿链路，可以继续接入真实 Agent Run。");
  }

  return Array.from(suggestions);
}

/**
 * 生成模型体系分析报告。
 *
 * 这里故意只做本地确定性检查：读取模型配置和模型路由，不读取 API Key，不请求真实模型。
 * 这样前端可以随时展示模型健康度，而不会产生调用费用或泄露密钥。
 */
export async function analyzeModelSetup(paths: WorkspacePaths) {
  const [configs, routes] = await Promise.all([listModelConfigs(paths), getModelRoutes(paths)]);
  const configIssues = configs.flatMap(analyzeConfig);
  const routeAnalysis = (Object.keys(routeLabels) as RouteKey[]).map((routeKey) =>
    analyzeRoute(routeKey, routes, configs)
  );
  const routeIssues = routeAnalysis.flatMap((route) =>
    route.issues.map((issue) =>
      createIssue(route.routeKey === "planningModelId" ? "warning" : "critical", route.label, issue, "route", route.modelConfigId)
    )
  );
  const issues = [...routeIssues, ...configIssues];
  const score = configs.length === 0 ? 0 : scoreIssues(issues, routeAnalysis);
  const status = configs.length === 0 ? "blocked" : toStatus(score, issues);

  return {
    generatedAt: new Date().toISOString(),
    score,
    status,
    summary: {
      totalConfigs: configs.length,
      enabledConfigs: configs.filter((config) => config.enabled).length,
      disabledConfigs: configs.filter((config) => !config.enabled).length,
      defaultModelName: configs.find((config) => config.isDefault)?.name ?? null,
      supportedAdapterConfigs: configs.filter((config) => hasModelProviderAdapter(config.provider)).length,
      routeReadyCount: routeAnalysis.filter((route) => route.ready).length
    },
    providerStats: countBy(configs, (config) => config.provider),
    purposeStats: countBy(configs, (config) => config.purpose),
    routes: routeAnalysis,
    issues,
    suggestions: createSuggestions(configs, routeAnalysis, issues)
  };
}

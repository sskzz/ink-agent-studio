/**
 * 写作风格领域类型（页面版）。
 * 由 writingStylesApi 把后端扁平记录组装为这些结构，页面组件只消费此处定义的类型。
 */

/** 风格参数条目：标签、展示值、说明与评分，供风格详情页的参数列表渲染。 */
export interface StyleParameter {
  label: string;
  value: string;
  description: string;
  score: number;
}

/** 去 AI 味规则：forbidden 禁止 / risk 风险 / encourage 鼓励，附检测与改写提示。 */
export interface AntiAiRule {
  type: "forbidden" | "risk" | "encourage";
  category: string;
  rule: string;
  detectHint: string;
  rewriteHint: string;
  severity: "low" | "medium" | "high";
}

/** 风格分析结果：语气画像、结构/去 AI 味规则、提示词片段与结构化参数；raw* 保留后端原始数据。 */
export interface AnalysisResult {
  schemaVersion?: string;
  summary: string;
  voiceProfile: string;
  structureRule: string;
  aiReductionRule: string;
  promptSnippet: string;
  stylePromptSnippet?: string;
  reviewPromptSnippet?: string;
  antiAiRules?: AntiAiRule[];
  rawParameters?: Record<string, unknown>;
  rawAnalysis?: unknown;
  rawFeatureProfile?: unknown;
  parameters: StyleParameter[];
}

/** 写作风格（页面版）：含来源模板、指标摘要、分析结果与版本/样本统计。 */
export interface WritingStyle {
  id: string;
  name: string;
  summary: string;
  sourceFiles: string[];
  tags: string[];
  lastAnalyzed: string;
  metrics: {
    tone: string;
    rhythm: string;
    pointOfView: string;
    aiReduction: string;
  };
  analysis: AnalysisResult;
  latestVersionId?: string | null;
  sampleCount?: number;
  validSampleCount?: number;
  status?: "draft" | "analyzing" | "ready" | "degraded" | "invalid";
}

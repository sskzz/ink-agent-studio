export interface StyleParameter {
  label: string;
  value: string;
  description: string;
  score: number;
}

export interface AntiAiRule {
  type: "forbidden" | "risk" | "encourage";
  category: string;
  rule: string;
  detectHint: string;
  rewriteHint: string;
  severity: "low" | "medium" | "high";
}

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

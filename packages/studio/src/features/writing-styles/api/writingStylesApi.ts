import { apiDelete, apiGet, apiPost } from "@/shared/api/http";
import type { AnalysisResult, AntiAiRule, StyleParameter, WritingStyle } from "@/features/writing-styles/data/writingStyles";

interface BackendWritingStyle {
  id: string;
  name: string;
  summary: string;
  parameters: Record<string, unknown>;
  sampleFileName: string | null;
  analysis?: BackendStyleAnalysis;
  featureProfile?: BackendStyleFeatureProfile;
  createdAt: string;
  updatedAt: string;
  latestVersionId?: string | null;
  sampleCount?: number;
  validSampleCount?: number;
  status?: "draft" | "analyzing" | "ready" | "degraded" | "invalid";
}

export interface WritingStyleSampleDto {
  id: string;
  fileName: string;
  contentLength: number;
  contentHash: string;
  quality: { usable: boolean; weight: number; detectedContentType: string; warnings: string[] };
  createdAt: string;
}

export interface WritingStyleVersionDto {
  id: string;
  styleHash: string;
  sampleCount: number;
  confidence: number;
  status: "degraded" | "usable" | "stable";
  createdAt: string;
}

interface BackendStyleFeatureProfile {
  schemaVersion: "style-features.v1";
  sourceContentLength: number;
  metrics: Record<string, number>;
}

interface BackendStyleAnalysis {
  schemaVersion: string;
  summary: string;
  voiceProfile: string;
  structureRule: string;
  aiReductionRule: string;
  stylePromptSnippet: string;
  reviewPromptSnippet: string;
  parameters: Record<string, unknown>;
  antiAiRules?: AntiAiRule[];
  [key: string]: unknown;
}

interface CreateWritingStyleInput {
  name: string;
  summary: string;
  parameters?: Record<string, unknown>;
  sampleFileName?: string | null;
  analysis?: AnalysisResult;
}

interface AnalyzeWritingStyleInput {
  name: string;
  sampleFileName: string;
  content: string;
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "刚刚";
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function toDisplayValue(value: unknown) {
  if (typeof value === "number") {
    return Number.isInteger(value) ? `${value}` : value.toFixed(2);
  }

  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "待补充";
  }

  return JSON.stringify(value);
}

function createParametersFromSource(source: Record<string, unknown>): StyleParameter[] {
  const entries = Object.entries(source);

  if (entries.length === 0) {
    return [
      {
        label: "风格状态",
        value: "待分析",
        description: "当前风格已保存，但尚未生成详细参数。",
        score: 60
      }
    ];
  }

  return entries.map(([key, value], index) => ({
    label: parameterLabel[key] ?? key,
    value: toDisplayValue(value),
    description: parameterDescription[key] ?? "由后端风格分析接口生成的结构化参数。",
    score: Math.max(62, 92 - index * 6)
  }));
}

function createAnalysis(record: BackendWritingStyle, parameters: StyleParameter[]): AnalysisResult {
  if (record.analysis) {
    return {
      schemaVersion: record.analysis.schemaVersion,
      summary: record.analysis.summary,
      voiceProfile: record.analysis.voiceProfile,
      structureRule: record.analysis.structureRule,
      aiReductionRule: record.analysis.aiReductionRule,
      promptSnippet: record.analysis.stylePromptSnippet,
      stylePromptSnippet: record.analysis.stylePromptSnippet,
      reviewPromptSnippet: record.analysis.reviewPromptSnippet,
      antiAiRules: record.analysis.antiAiRules ?? [],
      rawParameters: record.analysis.parameters,
      rawAnalysis: record.analysis,
      rawFeatureProfile: record.featureProfile,
      parameters: createParametersFromSource(record.analysis.parameters)
    };
  }

  const rhythm = toDisplayValue(record.parameters.rhythm);
  const note = toDisplayValue(record.parameters.note);

  return {
    summary: record.summary || "该风格已保存，后续可继续补充模板作品并重新分析。",
    voiceProfile: "根据模板文本生成语气画像，后续接入真实模型后会进一步拆解措辞、镜头感和情绪密度。",
    structureRule: rhythm === "待补充" ? "待分析结构规则。" : `当前节奏倾向：${rhythm}。`,
    aiReductionRule: note === "待补充" ? "减少模板化解释，优先保留动作、物件和场景反馈。" : note,
    promptSnippet: `使用「${record.name}」写作风格：参考已分析参数，保持语气、节奏和去 AI 味约束一致。`,
    rawParameters: record.parameters,
    parameters
  };
}

function toWritingStyle(record: BackendWritingStyle): WritingStyle {
  const parameters = createParametersFromSource(record.analysis?.parameters ?? record.parameters);
  const analysis = createAnalysis(record, parameters);
  const sourceFiles = record.sampleFileName ? [record.sampleFileName] : ["待补充模板作品"];
  const rawParameters = record.analysis?.parameters ?? record.parameters;

  return {
    id: record.id,
    name: record.name,
    summary: record.summary || analysis.summary,
    sourceFiles,
    tags: record.parameters && Object.keys(record.parameters).length > 0 ? ["AI 分析", "本地后端"] : ["草稿", "本地后端"],
    lastAnalyzed: formatDateTime(record.updatedAt),
    metrics: {
      tone: toDisplayValue(rawParameters.tone ?? "待分析"),
      rhythm: toDisplayValue(rawParameters.rhythm ?? rawParameters.pacing ?? "待分析"),
      pointOfView: toDisplayValue(rawParameters.pointOfView ?? "待分析"),
      aiReduction: toDisplayValue(rawParameters.aiReduction ?? rawParameters.note ?? "待分析")
    },
    analysis,
    latestVersionId: record.latestVersionId,
    sampleCount: record.sampleCount ?? 0,
    validSampleCount: record.validSampleCount ?? 0,
    status: record.status ?? "draft"
  };
}

const parameterLabel: Record<string, string> = {
  averageLineLength: "平均行长",
  dialogueRatio: "对话比例",
  paragraphCount: "段落数量",
  rhythm: "句式节奏",
  note: "分析备注",
  tone: "语气标签",
  register: "语言质地",
  pointOfView: "叙事视角",
  cameraDistance: "叙事距离",
  sentencePattern: "句式特征",
  paragraphPattern: "段落特征",
  dialogueStyle: "对白方式",
  descriptionFocus: "描写重心",
  emotionStyle: "情绪表达",
  narrativeDrive: "叙事驱动力",
  pacing: "节奏组织",
  sceneSuitability: "适用场景",
  aiReduction: "去 AI 味",
  confidence: "置信度"
};

const parameterDescription: Record<string, string> = {
  averageLineLength: "用于判断文本更偏短句推进还是长句铺陈。",
  dialogueRatio: "用于估算对话在样本文本中的占比。",
  paragraphCount: "用于估算样本文本的段落密度。",
  rhythm: "由平均行长推断出的基础节奏倾向。",
  note: "后端分析模块生成的去 AI 味或后续接入提示。",
  tone: "规划模型归纳的整体语气倾向。",
  register: "文本用语的口语化、书面化或质感倾向。",
  pointOfView: "模板文本主要使用的叙事视角。",
  cameraDistance: "叙述镜头与人物、场景之间的距离。",
  sentencePattern: "句子长短、断句和修饰密度的组合。",
  paragraphPattern: "段落长度、停顿和转场方式。",
  dialogueStyle: "对白承担的信息、关系和潜台词方式。",
  descriptionFocus: "描写更偏动作、环境、心理、感官或物件。",
  emotionStyle: "人物情绪被直接说明或间接呈现的方式。",
  narrativeDrive: "推动文本前进的主要力量。",
  pacing: "信息释放和动作推进的速度。",
  sceneSuitability: "该风格更适合使用的场景类型。",
  aiReduction: "后续生成和审稿时的机械化风险约束。",
  confidence: "规划模型对当前样本分析结果的置信度。"
};

export async function listWritingStyles(): Promise<WritingStyle[]> {
  const records = await apiGet<BackendWritingStyle[]>("/writing-styles");
  return records.map(toWritingStyle);
}

export async function createWritingStyle(input: CreateWritingStyleInput): Promise<WritingStyle> {
  const analysis = toBackendAnalysis(input.analysis);
  const record = await apiPost<BackendWritingStyle>("/writing-styles", {
    name: input.name,
    summary: input.summary,
    parameters: input.parameters ?? {},
    sampleFileName: input.sampleFileName ?? null,
    analysis,
    featureProfile: isFeatureProfile(input.analysis?.rawFeatureProfile)
      ? input.analysis.rawFeatureProfile
      : undefined
  });

  return toWritingStyle(record);
}

function toBackendAnalysis(analysis: AnalysisResult | undefined): BackendStyleAnalysis | undefined {
  if (!analysis || analysis.schemaVersion !== "style-analysis.v3") {
    return undefined;
  }

  if (isRecord(analysis.rawAnalysis) && analysis.rawAnalysis.schemaVersion === "style-analysis.v3") {
    return analysis.rawAnalysis as unknown as BackendStyleAnalysis;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFeatureProfile(value: unknown): value is BackendStyleFeatureProfile {
  return isRecord(value) && value.schemaVersion === "style-features.v1" && isRecord(value.metrics);
}

export async function analyzeWritingStyle(input: AnalyzeWritingStyleInput): Promise<WritingStyle> {
  const record = await apiPost<BackendWritingStyle>("/writing-styles/analyze", {
    name: input.name || "AI 分析风格",
    sampleFileName: input.sampleFileName || "sample.md",
    content: input.content
  });

  return toWritingStyle(record);
}

export async function listWritingStyleSamples(styleId: string) {
  return apiGet<WritingStyleSampleDto[]>(`/writing-styles/${styleId}/samples`);
}

export async function addWritingStyleSample(styleId: string, input: { fileName: string; content: string }) {
  return apiPost<WritingStyleSampleDto>(`/writing-styles/${styleId}/samples`, input);
}

export async function deleteWritingStyleSample(styleId: string, sampleId: string) {
  return apiDelete<{ id: string; deleted: boolean }>(`/writing-styles/${styleId}/samples/${sampleId}`);
}

export async function listWritingStyleVersions(styleId: string) {
  return apiGet<WritingStyleVersionDto[]>(`/writing-styles/${styleId}/versions`);
}

export async function rebuildWritingStyle(styleId: string) {
  return apiPost<Record<string, unknown>>(`/writing-styles/${styleId}/rebuild`, {});
}

export async function activateWritingStyleVersion(styleId: string, versionId: string) {
  return apiPost<Record<string, unknown>>(`/writing-styles/${styleId}/versions/${versionId}/activate`, {});
}

export async function previewWritingStyleConstraint(styleId: string, input: { sceneType?: string; instruction?: string; outline?: string } = {}) {
  return apiPost<Record<string, unknown>>(`/writing-styles/${styleId}/constraint-preview`, input);
}

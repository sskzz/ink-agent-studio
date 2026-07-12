import { apiGet, apiPost } from "@/shared/api/http";
import type { AnalysisResult, StyleParameter, WritingStyle } from "@/features/writing-styles/data/writingStyles";

interface BackendWritingStyle {
  id: string;
  name: string;
  summary: string;
  parameters: Record<string, unknown>;
  sampleFileName: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CreateWritingStyleInput {
  name: string;
  summary: string;
  parameters?: Record<string, unknown>;
  sampleFileName?: string | null;
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

function createParameters(record: BackendWritingStyle): StyleParameter[] {
  const entries = Object.entries(record.parameters);

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
  const rhythm = toDisplayValue(record.parameters.rhythm);
  const note = toDisplayValue(record.parameters.note);

  return {
    summary: record.summary || "该风格已保存，后续可继续补充模板作品并重新分析。",
    voiceProfile: "根据模板文本生成语气画像，后续接入真实模型后会进一步拆解措辞、镜头感和情绪密度。",
    structureRule: rhythm === "待补充" ? "待分析结构规则。" : `当前节奏倾向：${rhythm}。`,
    aiReductionRule: note === "待补充" ? "减少模板化解释，优先保留动作、物件和场景反馈。" : note,
    promptSnippet: `使用「${record.name}」写作风格：参考已分析参数，保持语气、节奏和去 AI 味约束一致。`,
    parameters
  };
}

function toWritingStyle(record: BackendWritingStyle): WritingStyle {
  const parameters = createParameters(record);
  const analysis = createAnalysis(record, parameters);
  const sourceFiles = record.sampleFileName ? [record.sampleFileName] : ["待补充模板作品"];

  return {
    id: record.id,
    name: record.name,
    summary: record.summary || analysis.summary,
    sourceFiles,
    searchKeywords: "本地后端风格库",
    tags: record.parameters && Object.keys(record.parameters).length > 0 ? ["AI 分析", "本地后端"] : ["草稿", "本地后端"],
    lastAnalyzed: formatDateTime(record.updatedAt),
    metrics: {
      tone: toDisplayValue(record.parameters.tone ?? "待分析"),
      rhythm: toDisplayValue(record.parameters.rhythm ?? "待分析"),
      pointOfView: toDisplayValue(record.parameters.pointOfView ?? "待分析"),
      aiReduction: toDisplayValue(record.parameters.aiReduction ?? record.parameters.note ?? "待分析")
    },
    analysis
  };
}

const parameterLabel: Record<string, string> = {
  averageLineLength: "平均行长",
  dialogueRatio: "对话比例",
  paragraphCount: "段落数量",
  rhythm: "句式节奏",
  note: "分析备注"
};

const parameterDescription: Record<string, string> = {
  averageLineLength: "用于判断文本更偏短句推进还是长句铺陈。",
  dialogueRatio: "用于估算对话在样本文本中的占比。",
  paragraphCount: "用于估算样本文本的段落密度。",
  rhythm: "由平均行长推断出的基础节奏倾向。",
  note: "后端分析模块生成的去 AI 味或后续接入提示。"
};

export async function listWritingStyles(): Promise<WritingStyle[]> {
  const records = await apiGet<BackendWritingStyle[]>("/writing-styles");
  return records.map(toWritingStyle);
}

export async function createWritingStyle(input: CreateWritingStyleInput): Promise<WritingStyle> {
  const record = await apiPost<BackendWritingStyle>("/writing-styles", {
    name: input.name,
    summary: input.summary,
    parameters: input.parameters ?? {},
    sampleFileName: input.sampleFileName ?? null
  });

  return toWritingStyle(record);
}

export async function analyzeWritingStyle(input: AnalyzeWritingStyleInput): Promise<WritingStyle> {
  const record = await apiPost<BackendWritingStyle>("/writing-styles/analyze", {
    name: input.name || "AI 分析风格",
    sampleFileName: input.sampleFileName || "sample.md",
    content: input.content
  });

  return toWritingStyle(record);
}

/**
 * 写作风格服务（索引与基础 CRUD）。
 * 职责：维护 styles 索引文件——列出/读取/创建/更新风格记录，以及样本分析预览（模型分析失败时降级为本地规则预览）；
 * 边界：索引级写操作统一走 "__style-index__" 锁；分析接口只返回预览不落盘，落盘由 createWritingStyle 完成；风格的深层版本管理在 writingStyleVersionService。
 */
import { randomUUID } from "node:crypto";
import {
  styleAnalyzeInputSchema,
  writingStyleAnalysisSchema,
  writingStyleCreateInputSchema,
  writingStylesIndexSchema,
  type WritingStyleAnalysis
} from "../../schemas/styleSchemas.js";
import { readJsonFile, writeJsonFile } from "../../utils/jsonStore.js";
import { notFound } from "../../utils/errors.js";
import { generateModelText } from "../ai/modelGateway.js";
import { getModelConfig, getModelRoutes } from "../models/modelConfigRepository.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import {
  buildWritingStyleAnalysisPrompts,
  STYLE_ANALYSIS_SCHEMA_VERSION,
  type WritingStyleLocalStats
} from "./writingStyleAnalysisPrompt.js";
import { createWritingStyleFeatureProfile, extractWritingStyleFeatures } from "./writingStyleFeatures.js";
import { syncWritingStyleDetail } from "./writingStyleRepository.js";
import { withWritingStyleLock } from "./writingStyleLock.js";

/** 读取风格索引（缺文件时返回空数组）。 */
async function readStyles(workspacePaths: WorkspacePaths) {
  return readJsonFile(workspacePaths.writingStylesFile, writingStylesIndexSchema, []);
}

/** 写回风格索引。 */
async function writeStyles(workspacePaths: WorkspacePaths, styles: Awaited<ReturnType<typeof readStyles>>) {
  await writeJsonFile(workspacePaths.writingStylesFile, styles);
}

/** 列出全部写作风格。 */
export async function listWritingStyles(workspacePaths: WorkspacePaths) {
  return readStyles(workspacePaths);
}

/** 根据作品保存的 writingStyleId 读取风格资产；无效引用必须显式报错，不能静默忽略。 */
export async function getWritingStyle(workspacePaths: WorkspacePaths, styleId: string) {
  const styles = await readStyles(workspacePaths);
  const style = styles.find((item) => item.id === styleId);

  if (!style) {
    throw notFound("写作风格不存在", { styleId });
  }

  return style;
}

/** 创建风格资产：带分析结果的标记为 degraded（未验证），纯草稿标记为 draft；新风格置于索引头部。 */
export async function createWritingStyle(workspacePaths: WorkspacePaths, body: unknown) {
  const input = writingStyleCreateInputSchema.parse(body);
  const now = new Date().toISOString();
  const style = {
    id: randomUUID(),
    name: input.name,
    summary: input.summary,
    parameters: input.parameters,
    sampleFileName: input.sampleFileName,
    analysis: input.analysis,
    featureProfile: input.featureProfile,
    latestVersionId: null,
    sampleCount: 0,
    validSampleCount: 0,
    status: input.analysis ? "degraded" as const : "draft" as const,
    createdAt: now,
    updatedAt: now
  };
  await withWritingStyleLock("__style-index__", async () => {
    const styles = await readStyles(workspacePaths);
    await writeStyles(workspacePaths, [style, ...styles]);
  });
  await syncWritingStyleDetail(workspacePaths, style);
  return style;
}

/** 局部更新风格记录（合并字段），id 与 updatedAt 由服务端强制维护，避免调用方篡改。 */
export async function updateWritingStyleRecord(
  workspacePaths: WorkspacePaths,
  styleId: string,
  update: Partial<Awaited<ReturnType<typeof getWritingStyle>>>
) {
  const next = await withWritingStyleLock("__style-index__", async () => {
    const styles = await readStyles(workspacePaths);
    const existing = styles.find((item) => item.id === styleId);
    if (!existing) throw notFound("写作风格不存在", { styleId });
    const value = { ...existing, ...update, id: existing.id, updatedAt: new Date().toISOString() };
    await writeStyles(workspacePaths, styles.map((item) => (item.id === styleId ? value : item)));
    return value;
  });
  await syncWritingStyleDetail(workspacePaths, next);
  return next;
}

/**
 * 分析风格样本（预览模式）。
 * @param body 待分析输入（name/content/sampleFileName）
 * @returns 预览风格记录：含模型分析结果 + 本地特征画像；失败时模型分析降级为本地规则预览
 */
export async function analyzeWritingStyle(workspacePaths: WorkspacePaths, body: unknown) {
  const input = styleAnalyzeInputSchema.parse(body);
  const { localStats, sampleContent } = extractWritingStyleFeatures(input.content, input.sampleFileName);
  const now = new Date().toISOString();
  const analysis = await analyzeWithPlanningModel(workspacePaths, {
    styleName: input.name,
    sampleFileName: input.sampleFileName,
    sampleContent,
    localStats
  });

  // 分析接口只返回预览结果，不直接写入风格库。
  // 用户点击“保存风格”后，前端再调用 createWritingStyle 持久化，避免误保存和重复记录。
  return {
    id: `analysis-${randomUUID()}`,
    name: input.name,
    summary: analysis.summary,
    sampleFileName: input.sampleFileName,
    parameters: analysis.parameters,
    analysis,
    featureProfile: createWritingStyleFeatureProfile(localStats),
    createdAt: now,
    updatedAt: now
  };
}

/** 调用规划模型分析；模型未配置/停用/调用失败时降级为本地规则预览并附带警告。 */
async function analyzeWithPlanningModel(
  workspacePaths: WorkspacePaths,
  input: {
    styleName: string;
    sampleFileName: string;
    sampleContent: string;
    localStats: WritingStyleLocalStats;
  }
): Promise<WritingStyleAnalysis> {
  try {
    const planningConfig = await getPlanningModelConfig(workspacePaths);
    const prompts = buildWritingStyleAnalysisPrompts({
      ...input,
      analysisDepth: "standard"
    });
    const result = await generateModelText(workspacePaths, planningConfig, {
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      temperature: 0.25,
      maxTokens: 2400,
      responseFormat: "json_object",
      timeoutMs: 45000
    });

    return parseModelAnalysis(result.text);
  } catch (error) {
    return createDeterministicAnalysis(input, [
      `规划模型分析未完成，已使用本地规则预览：${error instanceof Error ? error.message : String(error)}`
    ]);
  }
}

/** 解析规划模型配置：必须已路由且启用，否则抛出明确错误信息。 */
async function getPlanningModelConfig(workspacePaths: WorkspacePaths) {
  const routes = await getModelRoutes(workspacePaths);

  if (!routes.planningModelId) {
    throw new Error("未配置规划模型");
  }

  const config = await getModelConfig(workspacePaths, routes.planningModelId);

  if (!config.enabled) {
    throw new Error("规划模型配置已停用");
  }

  return config;
}

/** 解析模型 JSON：先 safeParse 校验 schema，失败抛出带原因的错，由上层降级。 */
function parseModelAnalysis(text: string): WritingStyleAnalysis {
  const jsonText = extractJsonText(text);
  const payload = JSON.parse(jsonText) as unknown;
  const parsed = writingStyleAnalysisSchema.safeParse(payload);

  if (!parsed.success) {
    throw new Error(`规划模型返回结果不符合风格分析 schema：${parsed.error.issues[0]?.message ?? "unknown"}`);
  }

  return parsed.data;
}

/** 从模型输出中提取 JSON：兼容 ```json 代码围栏与裸 JSON 两种返回形式。 */
function extractJsonText(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

/**
 * 本地规则预览：不调用模型，仅凭本地统计生成合规的分析记录，
 * 保证规划模型不可用时用户仍能看到风格分析的基本结果。
 */
function createDeterministicAnalysis(
  input: {
    styleName: string;
    sampleFileName: string;
    sampleContent: string;
    localStats: WritingStyleLocalStats;
  },
  warnings: string[]
): WritingStyleAnalysis {
  const rhythm = input.localStats.averageLineLength > 42 ? "长句铺陈" : "短句推进";
  // 置信度按样本规模收紧：截断样本不高于 80，短样本（<300 字）不高于 50，保证低置信度不被高估
  const confidence = Math.min(
    input.localStats.sampleTruncated ? 80 : 72,
    input.localStats.contentLength < 300 ? 50 : input.localStats.contentLength < 800 ? 65 : 72
  );
  const snippet = input.sampleContent.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 18) ?? "";

  return {
    schemaVersion: STYLE_ANALYSIS_SCHEMA_VERSION,
    summary: `基于 ${input.sampleFileName} 的本地规则预览，文本整体呈现${rhythm}倾向。`,
    voiceProfile: "样本由本地统计生成预览，具体语气画像需规划模型完成深层分析。",
    structureRule: `平均行长约 ${input.localStats.averageLineLength} 字，非空段落 ${input.localStats.paragraphCount} 段，当前节奏判断为${rhythm}。`,
    aiReductionRule: "避免用段尾总结替代人物反应，优先让动作、对白、环境变化承接情绪。",
    stylePromptSnippet: `按「${input.styleName}」风格写作：保持${rhythm}，优先复用样本的叙事距离、段落节奏和描写重心，不直接复制原文措辞。`,
    reviewPromptSnippet: "审稿时检查风格是否保持一致，并留意段尾总结、心理解释过满、对白缺少潜台词等机械化风险。",
    parameters: {
      tone: "样本不足，待补充",
      register: "样本不足，待补充",
      pointOfView: "样本不足，待补充",
      cameraDistance: "样本不足，待补充",
      sentencePattern: rhythm,
      paragraphPattern: input.localStats.paragraphCount > 8 ? "多段推进" : "段落较少",
      dialogueStyle: input.localStats.dialogueRatio > 0.25 ? "对白占比较高" : "对白占比较低",
      descriptionFocus: "样本不足，待补充",
      emotionStyle: "样本不足，待补充",
      narrativeDrive: "样本不足，待补充",
      pacing: rhythm,
      sceneSuitability: "样本不足，待补充",
      aiReduction: "动作、对白、环境优先承接情绪",
      confidence
    },
    dominantStyle: {
      name: rhythm,
      description: "由本地平均行长和段落密度推断，需规划模型进一步确认。",
      strength: confidence
    },
    secondaryStyles: [],
    executableRules: {
      narrativeRules: [{ rule: "叙事规则需等待规划模型深层分析后确认。", reason: "当前仅有本地统计。", priority: 1 }],
      languageRules: [{ rule: `句式暂按${rhythm}处理。`, reason: "由平均行长推断。", priority: 1 }],
      rhythmRules: [{ rule: `保持${rhythm}的基础节奏。`, reason: "由平均行长推断。", priority: 1 }],
      dialogueRules: [{ rule: "对白规则需结合更多上下文确认。", reason: "当前仅统计对白行占比。", priority: 2 }],
      descriptionRules: [{ rule: "描写重心需等待规划模型深层分析后确认。", reason: "本地规则无法可靠判断描写对象。", priority: 2 }],
      emotionRules: [{ rule: "情绪表达规则需等待规划模型深层分析后确认。", reason: "本地规则无法可靠判断情绪呈现。", priority: 2 }]
    },
    antiAiProfile: {
      riskLevel: "medium",
      mainRisks: ["段尾总结", "心理解释过满", "表达过于工整"],
      naturalnessPrinciple: "保留动作、对白和环境反馈，让情绪通过可观察细节呈现。"
    },
    antiAiRules: [
      {
        type: "forbidden",
        category: "emotion",
        rule: "禁止用段尾总结句替人物完成情绪表达。",
        detectHint: "检查段落末尾是否出现抽象情绪总结。",
        rewriteHint: "删掉总结，改为动作、沉默或环境反馈。",
        severity: "high"
      },
      {
        type: "risk",
        category: "logic",
        rule: "避免连续解释人物为什么这样想。",
        detectHint: "检查是否连续出现心理因果说明。",
        rewriteHint: "用对白、行为选择或细节反应替代解释。",
        severity: "medium"
      },
      {
        type: "risk",
        category: "language",
        rule: "避免过度工整的排比和抽象形容词堆叠。",
        detectHint: "检查连续句式是否过于对称。",
        rewriteHint: "打散句式，加入具体物件或动作承接。",
        severity: "medium"
      },
      {
        type: "encourage",
        category: "dialogue",
        rule: "鼓励保留潜台词和未说完的信息。",
        detectHint: "检查对白是否把人物真实意图说得过满。",
        rewriteHint: "删去直白解释，改用停顿、反问或转移话题。",
        severity: "low"
      }
    ],
    styleBoundaries: {
      bestFor: ["样本同类正文片段"],
      avoidFor: ["需要强体裁判断的复杂场景"],
      mustKeep: [rhythm, "不复制原文措辞"],
      canVary: ["描写密度", "对白比例"]
    },
    evidence: snippet
      ? [
          {
            feature: rhythm,
            reason: "用于提示本地预览的来源片段。",
            snippet
          }
        ]
      : [],
    warnings
  };
}

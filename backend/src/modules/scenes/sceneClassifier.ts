import { z } from "zod";
import { sceneTypeSchema, type SceneType } from "../../schemas/styleVersionSchemas.js";
import { generateModelText } from "../ai/modelGateway.js";
import { getModelConfig, getModelRoutes } from "../models/modelConfigRepository.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";

const classificationSchema = z.object({
  primary: sceneTypeSchema,
  secondary: sceneTypeSchema.nullable(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()).max(4)
});

export interface SceneClassification extends z.infer<typeof classificationSchema> {
  source: "user" | "outline" | "model" | "heuristic";
  tokenUsage?: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null } | null;
}

export async function classifyChapterScene(
  paths: WorkspacePaths,
  input: { requested: SceneType | "auto"; outline: string; instruction: string }
): Promise<SceneClassification> {
  if (input.requested !== "auto") {
    return { primary: input.requested, secondary: null, confidence: 1, evidence: ["用户明确指定场景类型"], source: "user" };
  }
  const local = classifyByHeuristic(`${input.outline}\n${input.instruction}`);
  if (local.confidence >= 0.72) return { ...local, source: input.outline.trim() ? "outline" : "heuristic" };
  try {
    const routes = await getModelRoutes(paths);
    if (!routes.planningModelId) return local;
    const model = await getModelConfig(paths, routes.planningModelId);
    if (!model.enabled) return local;
    const result = await generateModelText(paths, model, {
      systemPrompt: "你是小说章节场景分类器，只输出 JSON。",
      userPrompt: `根据章节细纲和指令判断主要场景。primary/secondary 只能是 action、dialogue、introspection、description、suspense、climax、transition、daily、mixed。\n细纲：${input.outline}\n指令：${input.instruction}`,
      temperature: 0.1,
      maxTokens: 300,
      responseFormat: "json_object",
      timeoutMs: 20000
    });
    const json = result.text.slice(result.text.indexOf("{"), result.text.lastIndexOf("}") + 1);
    return { ...classificationSchema.parse(JSON.parse(json)), source: "model", tokenUsage: result.tokenUsage ?? null };
  } catch {
    return local;
  }
}

function classifyByHeuristic(text: string): SceneClassification {
  const rules: Array<{ type: SceneType; keywords: string[] }> = [
    { type: "action", keywords: ["战斗", "追逐", "逃跑", "交手", "搏斗", "爆炸"] },
    { type: "dialogue", keywords: ["对话", "谈判", "争论", "审问", "交谈", "会议"] },
    { type: "introspection", keywords: ["回忆", "反思", "内心", "独白", "犹豫", "梦境"] },
    { type: "description", keywords: ["环境", "景色", "城市", "房间", "展示世界", "描写"] },
    { type: "suspense", keywords: ["悬念", "调查", "线索", "秘密", "跟踪", "真相"] },
    { type: "climax", keywords: ["高潮", "决战", "揭晓", "反转", "爆发"] },
    { type: "transition", keywords: ["转场", "过渡", "前往", "数日后", "与此同时"] },
    { type: "daily", keywords: ["日常", "吃饭", "上班", "上学", "休息"] }
  ];
  const scored = rules.map((rule) => ({ type: rule.type, score: rule.keywords.filter((word) => text.includes(word)).length })).sort((a, b) => b.score - a.score);
  const first = scored[0];
  if (!first || first.score === 0) return { primary: "mixed", secondary: null, confidence: 0.35, evidence: [], source: "heuristic" };
  const second = scored[1]?.score ? scored[1].type : null;
  return { primary: first.type, secondary: second, confidence: Math.min(0.85, 0.55 + first.score * 0.12), evidence: [`命中 ${first.score} 个${first.type}场景关键词`], source: "heuristic" };
}

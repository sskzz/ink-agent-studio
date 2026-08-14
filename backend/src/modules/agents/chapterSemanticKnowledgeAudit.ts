import { z } from "zod";
import type { RuntimeForeshadowing } from "../../schemas/runtimeStateSchemas.js";
import type { StoryPlanChapter, WorldRuleRegistry } from "../../schemas/storyKnowledgeSchemas.js";
import type { BookEntityRecord, ModelConfigRecord } from "../../types/domain.js";
import { sha256 } from "../../utils/hash.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { generateModelText } from "../ai/modelGateway.js";
import type { ModelGenerateTextResult } from "../ai/types.js";
import type { ChapterKnowledgeAuditReport } from "./chapterKnowledgeAudit.js";
import { readCharacterProfile } from "../books/storyKnowledgeRepository.js";
import { estimateTokens } from "../prompts/promptAssembler.js";

export const chapterSemanticKnowledgeAuditSchema = z.object({
  schemaVersion: z.literal("chapter-semantic-knowledge-audit.v1"),
  passed: z.boolean(),
  issues: z.array(z.object({
    code: z.string().trim().min(1).max(100),
    severity: z.enum(["warning", "blocking"]),
    sourceId: z.string().trim().min(1).max(160),
    evidence: z.string().trim().max(240).default(""),
    reason: z.string().trim().min(1).max(500),
    confidence: z.number().min(0).max(1)
  }).strict()).max(12)
}).strict();

type ChapterSemanticKnowledgeAuditBase = Omit<z.infer<typeof chapterSemanticKnowledgeAuditSchema>, "issues">;

export type ChapterSemanticKnowledgeAuditReport = ChapterSemanticKnowledgeAuditBase & {
  issues: Array<z.infer<typeof chapterSemanticKnowledgeAuditSchema>["issues"][number] & {
    fingerprint: string;
    decision: "confirmed" | "exempted" | null;
    effectiveSeverity: "warning" | "blocking";
  }>;
  triggered: boolean;
  modelConfigId: string | null;
  degradedReason: string | null;
  tokenUsage: ModelGenerateTextResult["tokenUsage"] | null;
  promptEstimateTokens: number;
};

export interface SemanticKnowledgeAuditInput {
  bookId: string;
  chapterNo: number;
  content: string;
  deterministicAudit: ChapterKnowledgeAuditReport;
  plannedChapter: StoryPlanChapter | null;
  entities: BookEntityRecord[];
  worldRules: WorldRuleRegistry | null;
  foreshadowing: RuntimeForeshadowing[];
  reviewModel: ModelConfigRecord | null;
  decisions?: Array<{ fingerprint: string; decision: "confirmed" | "exempted" }>;
}

export interface SemanticKnowledgeAuditDependencies {
  generateText?: typeof generateModelText;
}

/** 疑点信号只来自本地弱证据；没有信号时直接返回，不调用模型。 */
export function collectSemanticKnowledgeSuspicions(input: SemanticKnowledgeAuditInput) {
  const suspicions: Array<{ code: string; sourceId: string; reason: string; knowledge: string }> = [];
  for (const warning of input.deterministicAudit.warnings) {
    suspicions.push({ code: warning.code, sourceId: warning.sourceId, reason: warning.message, knowledge: renderCharacterKnowledge(input.entities, warning.sourceId) });
  }
  const planned = input.plannedChapter;
  if (planned) {
    const dimensions = [
      planned.dimensions.synopsis,
      ...planned.dimensions.characterActions.map((item) => item.action),
      ...planned.dimensions.scenes,
      ...planned.dimensions.conflicts,
      ...planned.dimensions.narrativeGoals
    ];
    const matches = dimensions.filter((item) => contentHasSignal(input.content, item)).length;
    if (matches < Math.min(3, dimensions.length)) {
      suspicions.push({
        code: "CHAPTER_DIMENSIONS_WEAK_COVERAGE",
        sourceId: `chapter-plan-${input.chapterNo}`,
        reason: `章纲五维度只有 ${matches}/${dimensions.length} 项检出文本弱覆盖，需要语义判断是否发生偏航。`,
        knowledge: dimensions.join("；")
      });
    }
  }
  for (const rule of input.worldRules?.rules ?? []) {
    if (rule.status !== "active" || rule.mutability !== "immutable" || rule.prohibitedExpressions.length > 0) continue;
    const keywords = keywordsFrom(rule.title + rule.content);
    if (keywords.filter((keyword) => input.content.includes(keyword)).length >= 2) {
      suspicions.push({
        code: "IMMUTABLE_WORLD_RULE_SEMANTIC_RISK",
        sourceId: rule.id,
        reason: `正文与不可变规则「${rule.title}」共享多个关键词，但规则没有显式禁用表达。`,
        knowledge: rule.content
      });
    }
  }
  return dedupeSuspicions(suspicions).slice(0, 8);
}

export async function auditChapterSemanticKnowledge(
  paths: WorkspacePaths,
  input: SemanticKnowledgeAuditInput,
  dependencies: SemanticKnowledgeAuditDependencies = {}
): Promise<ChapterSemanticKnowledgeAuditReport> {
  const suspicions = input.deterministicAudit.passed ? collectSemanticKnowledgeSuspicions(input) : [];
  if (suspicions.length === 0) return emptyReport(false, input.reviewModel?.id ?? null, null);
  if (!input.reviewModel?.enabled) return emptyReport(true, input.reviewModel?.id ?? null, "存在知识语义疑点，但审稿模型未配置或已停用。", suspicions);
  const prompt = buildSemanticKnowledgeAuditPrompt(input, suspicions);
  try {
    const generateText = dependencies.generateText ?? generateModelText;
    const result = await generateText(paths, input.reviewModel, {
      systemPrompt: "你是小说知识一致性审核器。仅判断给出的疑点，不做风格审稿。只输出合法 JSON。证据不足时给 warning，不得凭空制造 blocking。",
      userPrompt: prompt,
      temperature: 0,
      maxTokens: 1_200,
      responseFormat: "json_object",
      timeoutMs: 45_000
    });
    const parsed = parseReport(result.text);
    const decisionMap = new Map(input.decisions?.map((item) => [item.fingerprint, item.decision]) ?? []);
    const issues = parsed.issues.map((issue) => {
      const fingerprint = semanticKnowledgeIssueFingerprint(input.bookId, input.chapterNo, issue);
      const decision = decisionMap.get(fingerprint) ?? null;
      return {
        ...issue,
        fingerprint,
        decision,
        effectiveSeverity: decision === "exempted" ? "warning" as const : issue.severity
      };
    });
    return {
      ...parsed,
      passed: issues.every((issue) => issue.effectiveSeverity !== "blocking"),
      issues,
      triggered: true,
      modelConfigId: input.reviewModel.id,
      degradedReason: null,
      tokenUsage: result.tokenUsage ?? null,
      promptEstimateTokens: estimateTokens(prompt)
    };
  } catch (error) {
    return emptyReport(true, input.reviewModel.id, `知识语义疑点审核失败：${error instanceof Error ? error.message : String(error)}`, suspicions);
  }
}

export function semanticKnowledgeIssueFingerprint(
  bookId: string,
  chapterNo: number,
  issue: { code: string; sourceId: string; reason: string; evidence?: string }
) {
  return sha256(JSON.stringify({ bookId, chapterNo, code: issue.code, sourceId: issue.sourceId, reason: normalize(issue.reason), evidence: normalize(issue.evidence ?? "") }));
}

function emptyReport(
  triggered: boolean,
  modelConfigId: string | null,
  degradedReason: string | null,
  suspicions: Array<{ code: string; sourceId: string; reason: string }> = []
): ChapterSemanticKnowledgeAuditReport {
  return {
    schemaVersion: "chapter-semantic-knowledge-audit.v1",
    passed: true,
    issues: suspicions.map((item) => ({
      ...item,
      severity: "warning" as const,
      evidence: "",
      confidence: 0,
      fingerprint: sha256(`${item.code}:${item.sourceId}:${item.reason}`),
      decision: null,
      effectiveSeverity: "warning" as const
    })),
    triggered,
    modelConfigId,
    degradedReason,
    tokenUsage: null,
    promptEstimateTokens: 0
  };
}

function buildSemanticKnowledgeAuditPrompt(input: SemanticKnowledgeAuditInput, suspicions: ReturnType<typeof collectSemanticKnowledgeSuspicions>) {
  return [
    `作品 ID：${input.bookId}`,
    `章节：第 ${input.chapterNo} 章`,
    "【待判断疑点】",
    ...suspicions.map((item, index) => `${index + 1}. code=${item.code}; sourceId=${item.sourceId}\n原因：${item.reason}\n相关权威知识：${item.knowledge}`),
    "【正文】",
    input.content.slice(0, 24_000),
    "【输出契约】",
    "输出 schemaVersion=chapter-semantic-knowledge-audit.v1、passed、issues。每个 issue 包含 code、severity(warning|blocking)、sourceId、evidence、reason、confidence(0~1)。只有正文明确违背权威知识时才 blocking；隐式指代、同义转述、尚未覆盖但不矛盾时为 warning。"
  ].join("\n\n");
}

function parseReport(text: string) {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  return chapterSemanticKnowledgeAuditSchema.parse(JSON.parse(first >= 0 && last > first ? text.slice(first, last + 1) : text));
}

function renderCharacterKnowledge(entities: BookEntityRecord[], characterId: string) {
  const entity = entities.find((item) => item.id === characterId);
  const profile = entity ? readCharacterProfile(entity) : null;
  if (!entity) return characterId;
  return `${entity.name}：${entity.description}\n当前状态：${profile?.timeline.currentState ?? "未补充"}\n禁止行为：${profile?.core.prohibitedActions.join("；") || "无"}`;
}

function contentHasSignal(content: string, planned: string) {
  return keywordsFrom(planned).filter((keyword) => content.includes(keyword)).length >= 2;
}

function keywordsFrom(value: string) {
  return [...new Set(value.split(/[\s，。！？、；：,.!?;:（）()]+/u).flatMap((part) => {
    const characters = Array.from(part.trim());
    if (characters.length < 2) return [];
    if (characters.length <= 4) return [part.trim()];
    return Array.from({ length: characters.length - 1 }, (_, index) => characters.slice(index, index + 2).join(""));
  }))].filter((item) => item.length >= 2).slice(0, 80);
}

function normalize(value: string) {
  return value.replace(/[\s，。！？、；："'（）【】《》“”「」『』,.!?;:()\[\]<>]/gu, "").toLocaleLowerCase();
}

function dedupeSuspicions<T extends { code: string; sourceId: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.code}:${item.sourceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

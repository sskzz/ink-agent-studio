/**
 * 去 AI 味约束 API：读取共享的约束规则集。
 * 规则集由后端统一维护，前端只负责展示与按类别/阶段聚合。
 */
import { apiGet } from "@/shared/api/http";

/** 约束类别：情绪 / 对白 / 描写 / 结构 / 语言 / 逻辑 / 节奏。 */
export type AntiAiCategory = "emotion" | "dialogue" | "description" | "structure" | "language" | "logic" | "rhythm";

/** 单条约束规则：guard 为硬约束，baseline 为基线约束；styleAdjustable 表示可随写作风格微调。 */
export interface AntiAiConstraintRule {
  id: string;
  canonicalKey: string;
  title: string;
  category: AntiAiCategory;
  level: "guard" | "baseline";
  severity: "low" | "medium" | "high";
  promptClause: string;
  detectHint: string;
  rewriteHint: string;
  styleAdjustable: boolean;
  appliesTo: Array<"generation" | "review" | "polish">;
}

/** 约束规则集总览：版本信息、启用状态、提示词预算与分类统计，附带全部规则明细。 */
export interface AntiAiConstraintOverview {
  schemaVersion: "anti-ai-rule-set.v1";
  version: string;
  enabled: boolean;
  constraintHash: string;
  ruleCount: number;
  guardCount: number;
  stages: Array<"generation" | "review" | "polish">;
  promptBudget: { generationCharacters: number; reviewCharacters: number };
  categories: Array<{ category: AntiAiCategory; count: number }>;
  rules: AntiAiConstraintRule[];
}

/** 读取去 AI 味约束总览：页面加载时调用一次即可。 */
export function getAntiAiConstraints() {
  return apiGet<AntiAiConstraintOverview>("/anti-ai-constraints");
}


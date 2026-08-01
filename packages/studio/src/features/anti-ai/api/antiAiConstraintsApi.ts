import { apiGet } from "@/shared/api/http";

export type AntiAiCategory = "emotion" | "dialogue" | "description" | "structure" | "language" | "logic" | "rhythm";

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

export function getAntiAiConstraints() {
  return apiGet<AntiAiConstraintOverview>("/anti-ai-constraints");
}


export type ConstraintSource = "safety" | "world" | "character" | "user" | "outline" | "style-invariant" | "scene" | "style-metric" | "anti-ai-global" | "anti-ai-style";

export interface GenerationConstraint {
  id: string;
  key: string;
  source: ConstraintSource;
  priority: number;
  hard: boolean;
  text: string;
  metric?: { min: number; max: number; target: number; stability: number };
  sourceRef?: { fileId: string; contentHash?: string | null };
}

export function createConstraintResolutionTrace(resolution: ConstraintResolution) {
  const compact = (constraint: GenerationConstraint) => ({
    id: constraint.id,
    key: constraint.key,
    source: constraint.source,
    priority: constraint.priority,
    hard: constraint.hard,
    contentHash: hashText(constraint.text),
    summary: constraint.sourceRef
      ? `${constraint.source} constraint from ${constraint.sourceRef.fileId}`
      : constraint.text.replace(/\s+/g, " ").slice(0, 80),
    sourceRef: constraint.sourceRef ?? null,
    metric: constraint.metric ?? null
  });
  return {
    applied: resolution.applied.map(compact),
    dropped: resolution.dropped.map(compact),
    conflicts: resolution.conflicts,
    degraded: resolution.degraded,
    warnings: resolution.warnings
  };
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export interface ConstraintResolution {
  applied: GenerationConstraint[];
  dropped: GenerationConstraint[];
  conflicts: Array<{ winnerId: string; loserId: string; reason: string }>;
  degraded: boolean;
  warnings: string[];
}

/** 同一 key 视为同类约束，固定使用优先级高者；事实层永远不会被风格偏好覆盖。 */
export function resolveGenerationConstraints(constraints: GenerationConstraint[]): ConstraintResolution {
  const grouped = new Map<string, GenerationConstraint[]>();
  for (const constraint of constraints) grouped.set(constraint.key, [...(grouped.get(constraint.key) ?? []), constraint]);
  const applied: GenerationConstraint[] = [];
  const dropped: GenerationConstraint[] = [];
  const conflicts: ConstraintResolution["conflicts"] = [];
  for (const items of grouped.values()) {
    const sorted = [...items].sort((left, right) => right.priority - left.priority || Number(right.hard) - Number(left.hard));
    const winner = sorted[0]!;
    applied.push(winner);
    for (const loser of sorted.slice(1)) {
      dropped.push(loser);
      conflicts.push({ winnerId: winner.id, loserId: loser.id, reason: `${winner.source} 优先级 ${winner.priority} 高于 ${loser.source} ${loser.priority}` });
    }
  }
  return { applied: applied.sort((a, b) => b.priority - a.priority), dropped, conflicts, degraded: dropped.some((item) => item.hard), warnings: dropped.some((item) => item.hard) ? ["存在硬约束冲突，已按固定优先级处理。"] : [] };
}
import { createHash } from "node:crypto";

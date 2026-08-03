/**
 * 文件职责：生成约束的冲突消解与追踪：把多来源约束按 key 分组，固定保留优先级高者。
 * 边界：纯函数无 I/O；只做"选择"不做"生成"，约束的具体文本由各来源（世界观/风格/场景等）提供。
 */
export type ConstraintSource = "safety" | "world" | "character" | "user" | "outline" | "style-invariant" | "scene" | "style-metric" | "anti-ai-global" | "anti-ai-style";

/** 单条生成约束：来源、优先级、是否硬约束、文本（可选指标与来源引用）。 */
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

/** 把消解结果压成可审计的紧凑追踪信息（约束内容哈希 + 摘要），供 Run trace 落库。 */
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

/** 对约束文本做哈希，用于追踪内容的不可变标识。 */
function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** 消解结果：保留的约束、被丢弃的约束、冲突明细、是否降级与警告。 */
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
    // 组内排序：先比优先级，同级时硬约束优先（事实层通常 priority 更高，天然胜出）
    const sorted = [...items].sort((left, right) => right.priority - left.priority || Number(right.hard) - Number(left.hard));
    const winner = sorted[0]!;
    applied.push(winner);
    for (const loser of sorted.slice(1)) {
      dropped.push(loser);
      conflicts.push({ winnerId: winner.id, loserId: loser.id, reason: `${winner.source} 优先级 ${winner.priority} 高于 ${loser.source} ${loser.priority}` });
    }
  }
  // 有硬约束被丢弃说明配置本身冲突，标记降级并给出警告；结果按优先级倒序输出保证上层读取稳定
  return { applied: applied.sort((a, b) => b.priority - a.priority), dropped, conflicts, degraded: dropped.some((item) => item.hard), warnings: dropped.some((item) => item.hard) ? ["存在硬约束冲突，已按固定优先级处理。"] : [] };
}
import { createHash } from "node:crypto";

/**
 * 状态徽章组件（共享）：tone 决定徽章配色（sage 绿 / amber 琥珀 / blue 蓝 / rose 玫红），
 * 用于状态、级别等短标签展示。
 */
import type { ReactNode } from "react";

interface BadgeProps {
  children: ReactNode;
  tone?: "sage" | "amber" | "blue" | "rose";
}

/** 状态徽章：纯展示组件，无交互。 */
export function Badge({ children, tone = "sage" }: BadgeProps) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

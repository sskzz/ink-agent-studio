import type { ReactNode } from "react";

interface BadgeProps {
  children: ReactNode;
  tone?: "sage" | "amber" | "blue" | "rose";
}

export function Badge({ children, tone = "sage" }: BadgeProps) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

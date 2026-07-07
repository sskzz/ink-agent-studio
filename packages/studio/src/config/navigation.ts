import type { LucideIcon } from "lucide-react";
import {
  BookOpenText,
  Bot,
  BrainCircuit,
  ClipboardList,
  LibraryBig,
  Palette,
  Settings,
  SlidersHorizontal
} from "lucide-react";

export interface NavigationItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

// 顶层导航配置集中维护，新增功能页时优先在这里补入口。
export const navigationItems: NavigationItem[] = [
  { to: "/", label: "总览", icon: LibraryBig },
  { to: "/workspace", label: "作品库", icon: BookOpenText },
  { to: "/styles", label: "写作风格", icon: Palette },
  { to: "/agent", label: "Agent 控制台", icon: Bot },
  { to: "/state", label: "世界状态", icon: BrainCircuit },
  { to: "/models", label: "模型配置", icon: SlidersHorizontal },
  { to: "/runs", label: "运行记录", icon: ClipboardList },
  { to: "/settings", label: "设置", icon: Settings }
];

export const shellCopy = {
  brandEyebrow: "Local-first",
  brandName: "Ink Agent",
  sidebarBadge: "MVP",
  sidebarTitle: "本地优先创作系统",
  sidebarDescription: "当前页面架构先跑通壳子，后续再接 Hono API、Agent 管线和本地文件状态。",
  topbarEyebrow: "Workspace",
  topbarTitle: "创作工作台",
  statusPills: ["Local Session", "接口预留 · 前端优先"]
} as const;

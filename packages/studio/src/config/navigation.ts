/**
 * 顶层导航配置：导航项定义与外壳文案集中维护在此文件。
 * 新增功能页时优先在 navigationItems 中补入口，侧边栏与顶栏会自动跟随渲染。
 */
import type { LucideIcon } from "lucide-react";
import {
  BookOpenText,
  ClipboardList,
  Fingerprint,
  LibraryBig,
  Palette,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  WandSparkles
} from "lucide-react";

/** 导航项结构：to 为路由地址，section 决定侧边栏分组，eyebrow/description 用于顶栏与页面氛围文案。 */
export interface NavigationItem {
  to: string;
  label: string;
  icon: LucideIcon;
  section: "创作" | "智能协作" | "系统";
  eyebrow: string;
  description: string;
}

// 顶层导航配置集中维护，新增功能页时优先在这里补入口。
export const navigationItems: NavigationItem[] = [
  {
    to: "/",
    label: "总览",
    icon: LibraryBig,
    section: "创作",
    eyebrow: "Workspace",
    description: "查看当前已经接入的创作、质量控制和运行管理能力。"
  },
  {
    to: "/workspace",
    label: "作品库",
    icon: BookOpenText,
    section: "创作",
    eyebrow: "Books",
    description: "创建和管理本地作品，并从作品详情进入章节编辑器。"
  },
  {
    to: "/styles",
    label: "写作风格",
    icon: Palette,
    section: "创作",
    eyebrow: "Writing Style",
    description: "用本地文本样本分析、保存和版本化写作风格。"
  },
  {
    to: "/anti-ai",
    label: "去 AI 味",
    icon: ShieldCheck,
    section: "创作",
    eyebrow: "Quality Rules",
    description: "查看正文生成、审稿和修订共用的去 AI 味约束。"
  },
  {
    to: "/skills",
    label: "小说技能",
    icon: WandSparkles,
    section: "创作",
    eyebrow: "Novel Skills",
    description: "管理按任务渐进加载的规划、写作和审稿技能。"
  },
  {
    to: "/memory",
    label: "偏好记忆",
    icon: Fingerprint,
    section: "创作",
    eyebrow: "User Memory",
    description: "审批稳定的写作协作偏好，并预览实际提示词注入内容。"
  },
  {
    to: "/models",
    label: "模型配置",
    icon: SlidersHorizontal,
    section: "智能协作",
    eyebrow: "Models",
    description: "维护模型连接并配置规划、写作和审稿调用链路。"
  },
  {
    to: "/runs",
    label: "运行记录",
    icon: ClipboardList,
    section: "智能协作",
    eyebrow: "Runs",
    description: "查看任务事件、模型尝试以及待审批的状态补丁。"
  },
  {
    to: "/settings",
    label: "设置",
    icon: Settings,
    section: "系统",
    eyebrow: "Local Settings",
    description: "维护本地运行、上下文、记忆和技能等系统配置。"
  }
];

/** 外壳品牌与状态文案：集中维护，避免散落在组件中难以统一替换。 */
export const shellCopy = {
  brandEyebrow: "Local-first",
  brandName: "Ink Agent",
  statusPills: ["Local Session", "本地优先 · 数据持久化"]
} as const;

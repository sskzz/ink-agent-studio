/**
 * 编辑器页面类型：面板种类、导航项与分组结构。
 * EditorNavItem 同时驱动左侧章节/角色/实体导航树的渲染。
 */
import type { LucideIcon } from "lucide-react";

/** 编辑器面板类型：作品详情 / 空态 / 章节 / 角色管理 / 新建实体。 */
export type EditorPanelKind = "detail" | "empty" | "chapter" | "role-manager" | "create-entity";

/** 编辑器字段：label 为表单项名，hint 为补充说明，value 为当前值。 */
export interface EditorField {
  hint?: string;
  label: string;
  value: string;
}

/** 导航树节点：kind 决定点击后打开的面板，create* 配置用于“新建”入口。 */
export interface EditorNavItem {
  chapterId?: string;
  chips?: string[];
  createDescriptionLabel?: string;
  createNameLabel?: string;
  createPlaceholder?: string;
  fields?: EditorField[];
  icon: LucideIcon;
  id: string;
  kind: EditorPanelKind;
  meta?: string;
  paragraphs?: string[];
  summary: string;
  title: string;
}

/** 导航分组：title 为分组标题，items 为该组下的节点，addItemId 指向新建入口。 */
export interface EditorNavGroup {
  addItemId?: string;
  id: string;
  items: EditorNavItem[];
  title: string;
}

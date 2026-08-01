import type { LucideIcon } from "lucide-react";

export type EditorPanelKind = "detail" | "empty" | "chapter" | "draft" | "role-manager" | "create-entity";

export interface EditorField {
  hint?: string;
  label: string;
  value: string;
}

export interface EditorNavItem {
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

export interface EditorNavGroup {
  addItemId?: string;
  id: string;
  items: EditorNavItem[];
  title: string;
}

/**
 * 页面标题组件（共享）。
 * 所有功能页统一使用它保证标题、说明与右侧操作区的间距稳定；
 * actions 由调用方注入，窄屏时自然换行。
 */
import type { ReactNode } from "react";

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}

/**
 * 页面标题组件。
 *
 * 所有页面统一使用它，保证标题、说明和右侧操作区的间距稳定；
 * 窄屏时 actions 会自然换行，不会把内容挤出视口。
 */
export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p className="muted">{description}</p>
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}

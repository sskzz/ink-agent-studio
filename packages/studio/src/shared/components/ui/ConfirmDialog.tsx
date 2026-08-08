/**
 * 通用确认弹窗（项目样式）：替代浏览器原生 confirm。
 * 用于清空会话、删除章节等危险操作的二次确认；
 * 遮罩点击 / 取消按钮 / Esc 均可关闭，确认按钮支持危险配色。
 * 样式与作品库 DocumentModal 的玻璃拟态风格保持一致（见 global.css 的 confirm-dialog-*）。
 */
import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 危险操作：确认按钮使用红色 danger-button 样式。 */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 项目风格确认弹窗：受控组件，关闭行为由父级决定。 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  // 弹窗打开期间按 Esc 等价于取消（移除监听避免泄漏）
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="confirm-dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="confirm-dialog-icon"><TriangleAlert size={18} /></div>
        <div className="confirm-dialog-body">
          <h3>{title}</h3>
          <p>{message}</p>
        </div>
        <div className="confirm-dialog-actions">
          <button className="ghost-button" type="button" onClick={onCancel}>{cancelLabel}</button>
          <button className={danger ? "danger-button" : "primary-button"} type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

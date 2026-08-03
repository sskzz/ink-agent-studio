/**
 * 文档阅读弹层：用 MarkdownRenderer 预览角色/核心文件/世界观正文。
 * 点击遮罩或“关闭”按钮关闭；面板内点击会阻止冒泡，避免误关。
 */
import { MarkdownRenderer } from "@/shared/components/ui/MarkdownRenderer";
import type { DetailDocument } from "../types";

/** 文档弹层组件：受控组件，关闭行为由父级 onClose 决定。 */
export function DocumentModal({ document, onClose }: { document: DetailDocument; onClose: () => void }) {
  return (
    <div className="detail-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="detail-modal" role="dialog" aria-modal="true" aria-label={document.title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="detail-modal-header">
          <div>
            <p className="eyebrow">Markdown Preview</p>
            <h3>{document.title}</h3>
            <p>{document.subtitle}</p>
          </div>
          <button className="ghost-button" type="button" onClick={onClose}>关闭</button>
        </div>
        <div className="detail-modal-body"><MarkdownRenderer content={document.markdown} /></div>
      </section>
    </div>
  );
}

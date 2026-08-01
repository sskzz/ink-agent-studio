import { MarkdownRenderer } from "@/shared/components/ui/MarkdownRenderer";
import type { DetailDocument } from "../types";

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

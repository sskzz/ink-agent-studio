/**
 * 作品列表视图：卡片式展示后端作品库数据，点击卡片进入详情。
 */
import { Badge } from "@/shared/components/ui/Badge";
import type { BookDetail } from "../types";

/** 作品列表组件：books 为空时展示引导文案。 */
export function BookListView({ books, onOpenDetail }: { books: BookDetail[]; onOpenDetail: (bookId: string) => void }) {
  return (
    <section className="workspace-layout book-list-layout">
      <div className="book-list-panel">
        <div className="section-title">
          <div><p className="eyebrow">Library</p><h3>作品列表</h3><p className="muted">点击作品卡片进入详情。这里完全使用后端本地作品目录数据。</p></div>
        </div>
        <div className="book-card-grid">
          {books.length === 0 ? <div className="empty-list">后端作品库暂无数据。点击右上角“新建作品”创建第一本作品。</div> : null}
          {books.map((book) => (
            <button className="book-card book-card-button" key={book.id} type="button" onClick={() => onOpenDetail(book.id)}>
              <div className="style-card-head"><div><strong>{book.title}</strong><p>{book.genre}</p></div><Badge tone="blue">{book.status}</Badge></div>
              <div className="style-metric-grid"><span><em>已写章节</em>{book.progress.writtenChapters}</span><span><em>更新</em>{book.updatedAt}</span></div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { Trash2 } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { listWritingStyles } from "@/features/writing-styles/api/writingStylesApi";
import type { WritingStyle } from "@/features/writing-styles/data/writingStyles";
import { createWorkspaceBook, deleteWorkspaceBook, listWorkspaceBookDetails } from "@/shared/api/workspaceApi";
import { Badge } from "@/shared/components/ui/Badge";
import { MarkdownRenderer } from "@/shared/components/ui/MarkdownRenderer";
import { PageHeader } from "@/shared/components/ui/PageHeader";
import { SelectField } from "@/shared/components/ui/SelectField";

type WorkspaceView = "list" | "create" | "preview" | "detail";

interface WorkspaceRouteState {
  bookId?: string;
  view?: WorkspaceView;
}

interface BookDraft {
  title: string;
  genre: string;
  narrationPerspective: string;
  channel: string;
  writingStyleId: string;
  protagonistGender: string;
  protagonistName: string;
  plannedWords: string;
  chapterWords: string;
  brief: string;
  worldFileName: string;
  worldFileContent: string;
}

interface BookCharacter {
  id: string;
  name: string;
  role: "主要" | "次要";
  identity: string;
  markdown: string;
}

interface CoreFile {
  id: string;
  title: string;
  fileName: string;
  summary: string;
  markdown: string;
}

interface BookDetail {
  id: string;
  title: string;
  genre: string;
  status: string;
  updatedAt: string;
  brief: string;
  writingStyleId: string;
  attributes: {
    narrationPerspective: string;
    channel: string;
    protagonistGender: string;
    protagonistName: string;
    plannedWords: number;
    chapterWords: number;
    worldFileName: string;
  };
  progress: {
    currentChapter: string;
    writtenWords: number;
    writtenChapters: number;
    plannedChapters: number;
  };
  characters: BookCharacter[];
  coreFiles: CoreFile[];
  worldview: CoreFile;
}

interface DetailDocument {
  title: string;
  subtitle: string;
  markdown: string;
}

const initialDraft: BookDraft = {
  title: "",
  genre: "",
  narrationPerspective: "",
  channel: "",
  writingStyleId: "",
  protagonistGender: "",
  protagonistName: "",
  plannedWords: "",
  chapterWords: "",
  brief: "",
  worldFileName: "",
  worldFileContent: ""
};

function createWritingStyleOptions(styles: WritingStyle[]) {
  return [
    {
      label: "交给 AI 自动选择",
      value: "",
      description: "根据题材、简介和目标读者自动匹配风格"
    },
    ...styles.map((style) => ({
      label: style.name,
      value: style.id,
      description: style.summary
    }))
  ];
}

function getWritingStyleName(styles: WritingStyle[], styleId: string) {
  return styles.find((style) => style.id === styleId)?.name ?? "";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

/**
 * 作品库页面。
 *
 * 当前页面优先读取后端本地 workspace：
 * - 作品列表和详情来自 /api/v1/books。
 * - 核心文件和世界观通过 MarkdownRenderer 渲染后端读取的 md 内容。
 * - 新建作品会真实写入本地作品目录；后端不可用时才展示前端预览兜底。
 */
export function WorkspacePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [view, setView] = useState<WorkspaceView>("list");
  const [draft, setDraft] = useState<BookDraft>(initialDraft);
  const [createdDraft, setCreatedDraft] = useState<BookDraft | null>(null);
  const [books, setBooks] = useState<BookDetail[]>([]);
  const [writingStyles, setWritingStyles] = useState<WritingStyle[]>([]);
  const [selectedBookId, setSelectedBookId] = useState("");
  const [activeDocument, setActiveDocument] = useState<DetailDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");

  const selectedBook = books.find((book) => book.id === selectedBookId) ?? books[0];
  const writingStyleOptions = createWritingStyleOptions(writingStyles);

  useEffect(() => {
    const routeState = location.state as WorkspaceRouteState | null;

    if (routeState?.view === "detail" && routeState.bookId) {
      setSelectedBookId(routeState.bookId);
      setActiveDocument(null);
      setView("detail");
      navigate("/workspace", { replace: true, state: null });
    }
  }, [location.state, navigate]);

  useEffect(() => {
    let ignore = false;

    async function loadWorkspaceData() {
      setLoading(true);

      try {
        const [nextBooks, nextStyles] = await Promise.all([listWorkspaceBookDetails(), listWritingStyles()]);

        if (!ignore) {
          setBooks(nextBooks);
          setWritingStyles(nextStyles);
          setSelectedBookId((currentId) =>
            nextBooks.some((book) => book.id === currentId) ? currentId : nextBooks[0]?.id ?? ""
          );
          setFeedback("");
        }
      } catch (error) {
        if (!ignore) {
          setBooks([]);
          setWritingStyles([]);
          setSelectedBookId("");
          setFeedback(`后端作品库读取失败：${toMessage(error)}`);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void loadWorkspaceData();

    return () => {
      ignore = true;
    };
  }, []);

  function updateDraft(patch: Partial<BookDraft>) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      ...patch
    }));
  }

  function openCreateView() {
    setDraft(initialDraft);
    setCreatedDraft(null);
    setActiveDocument(null);
    setView("create");
  }

  function openListView() {
    setActiveDocument(null);
    setView("list");
  }

  function openDetailView(bookId: string) {
    setSelectedBookId(bookId);
    setActiveDocument(null);
    setView("detail");
  }

  function handleWorldFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      updateDraft({ worldFileName: "", worldFileContent: "" });
      return;
    }

    updateDraft({ worldFileName: file.name, worldFileContent: "" });

    // 新建作品时需要把用户上传的 world.md 正文写入后端，而不是只记录文件名。
    void file
      .text()
      .then((content) => {
        updateDraft({ worldFileName: file.name, worldFileContent: content });
      })
      .catch(() => {
        setFeedback("世界观 Markdown 文件读取失败，请重新选择 .md 文件后再创建作品。");
      });
  }

  async function saveDraft() {
    setSaving(true);

    try {
      const createdBook = await createWorkspaceBook(draft);
      setBooks((currentBooks) => [createdBook, ...currentBooks.filter((book) => book.id !== createdBook.id)]);
      setSelectedBookId(createdBook.id);
      setCreatedDraft(null);
      setFeedback("作品已创建到后端本地 workspace。");
      setView("detail");
    } catch (error) {
      setCreatedDraft(draft);
      setFeedback(`后端创建失败，已保留前端预览供检查：${toMessage(error)}`);
      setView("preview");
    } finally {
      setSaving(false);
    }
  }

  function continueWriting() {
    navigate("/editor", { state: { fromBookId: selectedBook?.id ?? selectedBookId } });
  }

  async function deleteSelectedBook() {
    if (!selectedBook || !window.confirm(`确定永久删除《${selectedBook.title}》吗？相关数据库记录和 Markdown 文件将全部删除，此操作无法撤销。`)) {
      return;
    }

    setSaving(true);
    setFeedback("");

    try {
      await deleteWorkspaceBook(selectedBook.id);
      const nextBooks = books.filter((book) => book.id !== selectedBook.id);
      setBooks(nextBooks);
      setSelectedBookId(nextBooks[0]?.id ?? "");
      setActiveDocument(null);
      setView("list");
      setFeedback(`《${selectedBook.title}》及其全部关联数据已删除。`);
    } catch (error) {
      setFeedback(`作品删除失败：${toMessage(error)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page workspace-page">
      <PageHeader
        eyebrow="Books"
        title={view === "detail" && selectedBook ? selectedBook.title : "作品库"}
        description={
          view === "detail" && selectedBook
            ? "查看当前作品信息、写作进度、角色、核心文件和世界观；点击条目可预览对应 Markdown 内容。"
            : "管理本地作品。新增作品时只需要填写你确定的信息，其余属性会在后续交给 AI 自动生成和补全。"
        }
        actions={
          view === "list" ? (
            <button className="primary-button" type="button" onClick={openCreateView}>
              新建作品
            </button>
          ) : view === "detail" ? (
            <>
              <button className="primary-button" type="button" onClick={continueWriting}>
                继续写作
              </button>
              <button className="danger-button" type="button" disabled={saving} onClick={() => void deleteSelectedBook()}>
                <Trash2 size={16} aria-hidden="true" />
                删除作品
              </button>
              <button className="ghost-button" type="button" onClick={openListView}>
                返回作品库
              </button>
            </>
          ) : (
            <button className="ghost-button" type="button" onClick={openListView}>
              返回作品库
            </button>
          )
        }
      />

      {loading ? <div className="test-banner">正在读取后端作品库...</div> : null}
      {saving ? <div className="test-banner">正在同步后端作品数据...</div> : null}
      {feedback ? <div className="test-banner success">{feedback}</div> : null}

      {view === "list" ? <BookListView books={books} onOpenDetail={openDetailView} /> : null}

      {view === "detail" && selectedBook ? (
        <BookDetailView
          book={selectedBook}
          writingStyles={writingStyles}
          onOpenDocument={setActiveDocument}
        />
      ) : null}

      {view === "create" ? (
        <CreateBookView
          draft={draft}
          saving={saving}
          writingStyleOptions={writingStyleOptions}
          onFileChange={handleWorldFileChange}
          onSave={saveDraft}
          onUpdate={updateDraft}
        />
      ) : null}

      {view === "preview" && createdDraft ? (
        <BookPreviewView draft={createdDraft} writingStyles={writingStyles} onCreateAnother={openCreateView} />
      ) : null}

      {activeDocument ? <DocumentModal document={activeDocument} onClose={() => setActiveDocument(null)} /> : null}
    </div>
  );
}

interface BookListViewProps {
  books: BookDetail[];
  onOpenDetail: (bookId: string) => void;
}

function BookListView({ books, onOpenDetail }: BookListViewProps) {
  return (
    <section className="workspace-layout book-list-layout">
      <div className="book-list-panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Library</p>
            <h3>作品列表</h3>
            <p className="muted">点击作品卡片进入详情。这里完全使用后端本地作品目录数据。</p>
          </div>
        </div>

        <div className="book-card-grid">
          {books.length === 0 ? (
            <div className="empty-list">后端作品库暂无数据。点击右上角“新建作品”创建第一本作品。</div>
          ) : null}
          {books.map((book) => (
            <button className="book-card book-card-button" key={book.id} type="button" onClick={() => onOpenDetail(book.id)}>
              <div className="style-card-head">
                <div>
                  <strong>{book.title}</strong>
                  <p>{book.genre}</p>
                </div>
                <Badge tone="blue">{book.status}</Badge>
              </div>
              <div className="style-metric-grid">
                <span>
                  <em>已写章节</em>
                  {book.progress.writtenChapters}
                </span>
                <span>
                  <em>更新</em>
                  {book.updatedAt}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

interface BookDetailViewProps {
  book: BookDetail;
  writingStyles: WritingStyle[];
  onOpenDocument: (document: DetailDocument) => void;
}

function BookDetailView({ book, writingStyles, onOpenDocument }: BookDetailViewProps) {
  const attributeRows = [
    ["作品类型", book.genre],
    ["写作风格", getWritingStyleName(writingStyles, book.writingStyleId) || "AI 自动选择"],
    ["人称", book.attributes.narrationPerspective],
    ["频道", book.attributes.channel],
    ["主角性别", book.attributes.protagonistGender],
    ["主角姓名", book.attributes.protagonistName],
    ["小说计划字数", `${formatNumber(book.attributes.plannedWords)} 字`],
    ["每章节计划字数", `${formatNumber(book.attributes.chapterWords)} 字`],
    ["世界观文件", book.attributes.worldFileName]
  ];

  return (
    <section className="book-detail-view">
      <div className="detail-stat-grid">
        <article>
          <span>当前章节</span>
          <strong>{book.progress.currentChapter}</strong>
        </article>
        <article>
          <span>已写字数</span>
          <strong>{formatNumber(book.progress.writtenWords)}</strong>
        </article>
        <article>
          <span>已写章节</span>
          <strong>
            {book.progress.writtenChapters}/{book.progress.plannedChapters}
          </strong>
        </article>
        <article>
          <span>最近更新</span>
          <strong>{book.updatedAt}</strong>
        </article>
      </div>

      <div className="book-detail-grid">
        <section className="book-section-card detail-span-2">
          <div className="section-title">
            <div>
              <p className="eyebrow">Attributes</p>
              <h3>作品属性</h3>
            </div>
          </div>
          <div className="book-attribute-grid">
            {attributeRows.map(([label, value]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
        </section>

        <section className="book-section-card">
          <div className="section-title">
            <div>
              <p className="eyebrow">Characters</p>
              <h3>角色列表</h3>
              <p className="muted">点击角色查看对应角色 Markdown 文件。</p>
            </div>
          </div>
          <div className="detail-list">
            {book.characters.map((character) => (
              <button
                className="detail-list-item"
                key={character.id}
                type="button"
                onClick={() =>
                  onOpenDocument({
                    title: character.name,
                    subtitle: `${character.identity} · ${character.role}角色`,
                    markdown: character.markdown
                  })
                }
              >
                <span>
                  <strong>{character.name}</strong>
                  <small>{character.identity}</small>
                </span>
                <Badge tone={character.role === "主要" ? "amber" : "blue"}>{character.role}</Badge>
              </button>
            ))}
          </div>
        </section>

        <section className="book-section-card">
          <div className="section-title">
            <div>
              <p className="eyebrow">Core Files</p>
              <h3>核心文件</h3>
              <p className="muted">点击文件查看对应 md 内容。</p>
            </div>
          </div>
          <div className="detail-list">
            {book.coreFiles.map((file) => (
              <button
                className="detail-list-item"
                key={file.id}
                type="button"
                onClick={() =>
                  onOpenDocument({
                    title: file.title,
                    subtitle: file.fileName,
                    markdown: file.markdown
                  })
                }
              >
                <span>
                  <strong>{file.title}</strong>
                  <small>{file.summary}</small>
                </span>
                <em>{file.fileName}</em>
              </button>
            ))}
          </div>
        </section>

        <section className="book-section-card detail-span-2">
          <div className="section-title">
            <div>
              <p className="eyebrow">World</p>
              <h3>世界观</h3>
              <p className="muted">点击卡片查看 `world.md` 渲染结果。</p>
            </div>
          </div>
          <button
            className="worldview-card"
            type="button"
            onClick={() =>
              onOpenDocument({
                title: book.worldview.title,
                subtitle: book.worldview.fileName,
                markdown: book.worldview.markdown
              })
            }
          >
            <span>WORLD.MD</span>
            <strong>{book.worldview.summary}</strong>
            <p>内容来自本地作品目录中的 Markdown 文件，上传的世界观 md 会在这里渲染。</p>
          </button>
        </section>
      </div>
    </section>
  );
}

interface CreateBookViewProps {
  draft: BookDraft;
  saving: boolean;
  writingStyleOptions: ReturnType<typeof createWritingStyleOptions>;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSave: () => void;
  onUpdate: (patch: Partial<BookDraft>) => void;
}

function CreateBookView({
  draft,
  saving,
  writingStyleOptions,
  onFileChange,
  onSave,
  onUpdate
}: CreateBookViewProps) {
  return (
    <section className="workspace-layout book-create-layout">
      <div className="book-form-panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Create Book</p>
            <h3>新建作品</h3>
            <p className="muted">所有作品属性都不是必填。你不确定的地方可以留空，后续由 AI 自动补全。</p>
          </div>
          <Badge tone="sage">本地优先</Badge>
        </div>

        <form className="book-form" onSubmit={(event) => event.preventDefault()}>
          <label className="field">
            <span>作品名称</span>
            <input
              value={draft.title}
              placeholder="例如：星海归档"
              onChange={(event) => onUpdate({ title: event.target.value })}
            />
            <small>可选。不填时 AI 会根据简介和题材生成临时作品名。</small>
          </label>

          <label className="field">
            <span>作品类型 / 题材</span>
            <input
              value={draft.genre}
              placeholder="例如：都市悬疑、轻幻想、赛博修仙"
              onChange={(event) => onUpdate({ genre: event.target.value })}
            />
            <small>可选。不填时 AI 会根据作品简介推断题材。</small>
          </label>

          <div className="field">
            <span>人称</span>
            <SelectField
              value={draft.narrationPerspective}
              options={[
                { label: "交给 AI 选择", value: "", description: "根据题材和目标读者自动选择叙事人称" },
                { label: "第一人称", value: "第一人称" },
                { label: "第三人称", value: "第三人称" }
              ]}
              onChange={(value) => onUpdate({ narrationPerspective: value })}
            />
            <small>可选。不选时 AI 会根据作品类型推荐人称。</small>
          </div>

          <div className="field">
            <span>频道</span>
            <SelectField
              value={draft.channel}
              options={[
                { label: "交给 AI 选择", value: "", description: "根据题材、主角和读者定位自动选择频道" },
                { label: "男频", value: "男频" },
                { label: "女频", value: "女频" }
              ]}
              onChange={(value) => onUpdate({ channel: value })}
            />
            <small>可选。不选时 AI 会根据作品定位生成频道建议。</small>
          </div>

          <div className="field full">
            <span>写作风格</span>
            <SelectField
              value={draft.writingStyleId}
              options={writingStyleOptions}
              onChange={(value) => onUpdate({ writingStyleId: value })}
            />
            <small>可选。这里从“写作风格”功能中的风格列表选择，不选则由 AI 自动匹配。</small>
          </div>

          <div className="field">
            <span>主角性别</span>
            <SelectField
              value={draft.protagonistGender}
              options={[
                { label: "交给 AI 生成", value: "", description: "根据作品定位自动生成主角设定" },
                { label: "男", value: "男" },
                { label: "女", value: "女" },
                { label: "非固定 / 群像", value: "非固定 / 群像" },
                { label: "自定义", value: "自定义" }
              ]}
              onChange={(value) => onUpdate({ protagonistGender: value })}
            />
            <small>可选。不选时 AI 会根据作品定位生成更合适的主角设定。</small>
          </div>

          <label className="field">
            <span>主角姓名</span>
            <input
              value={draft.protagonistName}
              placeholder="例如：林砚 / 苏白鹿"
              onChange={(event) => onUpdate({ protagonistName: event.target.value })}
            />
            <small>可选。不填时 AI 会根据时代、地域、风格生成姓名。</small>
          </label>

          <label className="field">
            <span>小说计划字数</span>
            <input
              min="0"
              type="number"
              value={draft.plannedWords}
              placeholder="例如：800000"
              onChange={(event) => onUpdate({ plannedWords: event.target.value })}
            />
            <small>可选。不填时 AI 会按作品类型推荐总字数。</small>
          </label>

          <label className="field">
            <span>每章节计划字数</span>
            <input
              min="0"
              type="number"
              value={draft.chapterWords}
              placeholder="例如：3000"
              onChange={(event) => onUpdate({ chapterWords: event.target.value })}
            />
            <small>可选。不填时 AI 会按节奏和平台习惯推荐章节长度。</small>
          </label>

          <label className="field full">
            <span>作品简介 / 创作方向</span>
            <textarea
              value={draft.brief}
              placeholder="写一点你已经确定的设定、开局、主线冲突或想要的阅读感觉。不写也可以。"
              onChange={(event) => onUpdate({ brief: event.target.value })}
            />
            <small>可选。不填时 AI 会先生成一个可修改的作品简报。</small>
          </label>

          <div className="field full">
            <span>世界观 Markdown 文件</span>
            <label className="world-upload-card">
              <input accept=".md,.markdown" className="native-file-input" type="file" onChange={onFileChange} />
              <span className="source-upload-icon">MD</span>
              <div>
                <strong>{draft.worldFileName || "上传世界观 md 文件"}</strong>
                <p>可选。上传后会写入作品目录的 `world.md`；若不上传，AI 后续会根据作品简介生成世界观。</p>
              </div>
            </label>
          </div>

          <div className="button-row">
            <button className="primary-button" type="button" disabled={saving} onClick={onSave}>
              {saving ? "正在创建作品..." : "创建作品"}
            </button>
            <button className="ghost-button" type="button" onClick={() => onUpdate(initialDraft)}>
              清空表单
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

interface BookPreviewViewProps {
  draft: BookDraft;
  writingStyles: WritingStyle[];
  onCreateAnother: () => void;
}

function BookPreviewView({ draft, writingStyles, onCreateAnother }: BookPreviewViewProps) {
  const previewRows = [
    ["作品名称", draft.title || "AI 自动生成"],
    ["题材类型", draft.genre || "AI 自动推断"],
    ["写作风格", getWritingStyleName(writingStyles, draft.writingStyleId) || "AI 自动选择"],
    ["人称", draft.narrationPerspective || "AI 自动选择"],
    ["频道", draft.channel || "AI 自动选择"],
    ["主角性别", draft.protagonistGender || "AI 自动生成"],
    ["主角姓名", draft.protagonistName || "AI 自动生成"],
    ["小说计划字数", draft.plannedWords ? `${draft.plannedWords} 字` : "AI 推荐总字数"],
    ["每章节计划字数", draft.chapterWords ? `${draft.chapterWords} 字` : "AI 推荐章节长度"],
    ["世界观文件", draft.worldFileName || "AI 生成 world.md"]
  ];

  return (
    <section className="book-preview-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Preview</p>
          <h3>作品创建预览</h3>
          <p className="muted">后端创建失败时展示此预览，方便检查即将提交的作品属性和 AI 补全范围。</p>
        </div>
        <Badge tone="amber">本地预览</Badge>
      </div>

      <div className="book-preview-grid">
        {previewRows.map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>

      <div className="prompt-preview">
        <span>下一步将生成</span>
        <p>`brief.md`、`outline.md`、`chapters/`、`state/world.json`、`state/characters.json`、`runs/`。</p>
      </div>

      <button className="primary-button" type="button" onClick={onCreateAnother}>
        继续新建作品
      </button>
    </section>
  );
}

interface DocumentModalProps {
  document: DetailDocument;
  onClose: () => void;
}

function DocumentModal({ document, onClose }: DocumentModalProps) {
  return (
    <div className="detail-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="detail-modal" role="dialog" aria-modal="true" aria-label={document.title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="detail-modal-header">
          <div>
            <p className="eyebrow">Markdown Preview</p>
            <h3>{document.title}</h3>
            <p>{document.subtitle}</p>
          </div>
          <button className="ghost-button" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="detail-modal-body">
          <MarkdownRenderer content={document.markdown} />
        </div>
      </section>
    </div>
  );
}

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

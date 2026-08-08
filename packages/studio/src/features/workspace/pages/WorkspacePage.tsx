/**
 * 作品库页：列表 / 新建 / 详情 / 兜底预览四种视图。
 * 详情页内置 AI 初始化状态轮询（1.5s）与 SSE 事件订阅，支持暂停、重试初始化；
 * 新建作品会把上传的 world.md 正文一并写入后端。
 */
import type { RunEvent } from "@ink-agent/contracts";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, MutableRefObject } from "react";
import { Trash2 } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { getRun, subscribeRunEvents, pauseRun } from "@/features/runs/api/runsApi";
import { listWritingStyles, listWritingStyleVersions } from "@/features/writing-styles/api/writingStylesApi";
import type { WritingStyleVersionDto } from "@/features/writing-styles/api/writingStylesApi";
import type { WritingStyle } from "@/features/writing-styles/data/writingStyles";
import {
  createWorkspaceBook,
  deleteWorkspaceBook,
  getWorkspaceBookDetail,
  getWorkspaceBookInitialization,
  listWorkspaceBookDetails,
  retryWorkspaceBookInitialization
} from "@/shared/api/workspaceApi";
import { Badge } from "@/shared/components/ui/Badge";
import { PageHeader } from "@/shared/components/ui/PageHeader";
import { SelectField } from "@/shared/components/ui/SelectField";
import { DocumentModal } from "@/features/workspace/components/DocumentModal";
import { BookListView } from "@/features/workspace/components/BookListView";
import type { BookDetail, BookDraft, DetailDocument } from "@/features/workspace/types";

type WorkspaceView = "list" | "create" | "preview" | "detail";

/** 路由 state：支持从外壳“新建作品”按钮或编辑器跳转到指定视图。 */
interface WorkspaceRouteState {
  bookId?: string;
  view?: WorkspaceView;
}

/** 新建作品的空表单初始值：全部字段留空，交给 AI 自动补全。 */
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

/** 初始化仍处于活跃状态（需要轮询/订阅）的状态集合。 */
const activeInitializationStatuses = new Set(["queued", "running", "cancelling"]);

/** 初始化阶段 key → 中文阶段名，用于进度展示。 */
const initializationStageLabels: Record<string, string> = {
  foundation: "基础设置与故事基石",
  world: "世界观骨架",
  story_graph: "核心人物与势力",
  story_backbone: "关键事件时间线",
  outline_plan: "总纲与分卷规划",
  entity_requirements: "剧情实体需求",
  outline: "总纲与分卷规划",
  supporting_entities: "地点与次要角色",
  items: "关键物品",
  initial_state: "初始状态与伏笔池",
  review_entity_state: "实体与初始状态交叉检查",
  review_fact_fidelity: "事实忠实度检查",
  review_bundle: "全局硬冲突检查",
  apply_bundle: "写入作品文件"
};

/** 写作风格下拉选项：首项“交给 AI 自动选择”，其余为已保存风格。 */
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

/** 根据风格 id 取风格名；未匹配返回空串（调用方显示为“AI 自动选择”）。 */
function getWritingStyleName(styles: WritingStyle[], styleId: string) {
  return styles.find((style) => style.id === styleId)?.name ?? "";
}

/** 版本创建时间格式化为“YY-MM-DD”，用于风格版本的展示名。 */
function formatVersionDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "未知日期";
  }

  return date.toLocaleString("zh-CN", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit"
  });
}

/**
 * 风格版本展示名：优先用“风格名称 · 版本日期”，并标记是否最新；
 * 版本记录缺失时回退到风格名称，避免直接暴露后端版本 id。
 */
function getStyleVersionLabel(
  styles: WritingStyle[],
  versionRecords: Map<string, WritingStyleVersionDto>,
  styleId: string,
  versionId: string
) {
  if (!versionId) return "未固定版本";
  const style = styles.find((item) => item.id === styleId);
  const styleName = style?.name ?? "未知风格";
  const version = versionRecords.get(versionId);

  if (!version) {
    return style?.latestVersionId === versionId ? `${styleName} · 最新版本` : styleName;
  }

  const isLatest = style?.latestVersionId === versionId;
  return `${styleName} · ${formatVersionDate(version.createdAt)}${isLatest ? "（最新）" : ""}`;
}

/** 数字按千分位格式化，用于字数统计展示。 */
function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

/** 作品库页主组件：视图状态、初始化轮询/订阅与所有作品操作都集中在此。 */
export function WorkspacePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [view, setView] = useState<WorkspaceView>("list");
  const [draft, setDraft] = useState<BookDraft>(initialDraft);
  const [createdDraft, setCreatedDraft] = useState<BookDraft | null>(null);
  const [books, setBooks] = useState<BookDetail[]>([]);
  const [writingStyles, setWritingStyles] = useState<WritingStyle[]>([]);
  const [styleVersions, setStyleVersions] = useState<Map<string, WritingStyleVersionDto>>(new Map());
  const [selectedBookId, setSelectedBookId] = useState("");
  const [activeDocument, setActiveDocument] = useState<DetailDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [worldFileReading, setWorldFileReading] = useState(false);
  const [worldFileError, setWorldFileError] = useState("");
  const [initializationEvents, setInitializationEvents] = useState<RunEvent[]>([]);
  const [initializationStreamError, setInitializationStreamError] = useState("");
  const [pausingInitialization, setPausingInitialization] = useState(false);
  const [streamRefreshKey, setStreamRefreshKey] = useState(0);
  const worldFileReadVersion = useRef(0);

  const selectedBook = books.find((book) => book.id === selectedBookId) ?? books[0];
  const writingStyleOptions = createWritingStyleOptions(writingStyles);

  // 处理从侧边栏“新建作品”或作品卡片带入的路由 state；处理后即清掉 state 防止刷新重复触发。
  useEffect(() => {
    const routeState = location.state as WorkspaceRouteState | null;

    if (routeState?.view === "detail" && routeState.bookId) {
      setSelectedBookId(routeState.bookId);
      setActiveDocument(null);
      setView("detail");
      navigate("/workspace", { replace: true, state: null });
    } else if (routeState?.view === "create") {
      worldFileReadVersion.current += 1;
      setDraft(initialDraft);
      setCreatedDraft(null);
      setActiveDocument(null);
      setWorldFileReading(false);
      setWorldFileError("");
      setView("create");
      navigate("/workspace", { replace: true, state: null });
    }
  }, [location.state, navigate]);

  // 挂载时并行加载作品列表与写作风格；ignore 标记防止卸载后 setState。
  useEffect(() => {
    let ignore = false;

    async function loadWorkspaceData() {
      setLoading(true);

      try {
        const [nextBooks, nextStyles] = await Promise.all([listWorkspaceBookDetails(), listWritingStyles()]);
        // 版本 id 是后端生成的不透明值，需要版本元信息（创建时间等）才能展示为可读名称。
        const versionRecords = new Map<string, WritingStyleVersionDto>();
        await Promise.all(nextStyles.map(async (style) => {
          if (!style.latestVersionId) return;
          try {
            for (const version of await listWritingStyleVersions(style.id)) {
              versionRecords.set(version.id, version);
            }
          } catch {
            // 单个风格版本读取失败不阻塞页面；对应版本行回退为风格名称。
          }
        }));

        if (!ignore) {
          setBooks(nextBooks);
          setWritingStyles(nextStyles);
          setStyleVersions(versionRecords);
          setSelectedBookId((currentId) =>
            nextBooks.some((book) => book.id === currentId) ? currentId : nextBooks[0]?.id ?? ""
          );
          setFeedback("");
        }
      } catch (error) {
        if (!ignore) {
          setBooks([]);
          setWritingStyles([]);
          setStyleVersions(new Map());
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

  // 初始化处于活跃状态时每 1.5s 轮询进度；完成后拉取完整详情刷新作品数据。
  useEffect(() => {
    const initialization = selectedBook?.initialization;
    if (view !== "detail" || !selectedBookId || !initialization || !activeInitializationStatuses.has(initialization.status)) {
      return;
    }
    let ignore = false;
    const timer = window.setInterval(() => {
      void getWorkspaceBookInitialization(selectedBookId).then(async (nextInitialization) => {
        if (ignore) return;
        if (nextInitialization?.status === "completed") {
          const updated = await getWorkspaceBookDetail(selectedBookId);
          if (ignore) return;
          setBooks((current) => current.map((book) => book.id === updated.id ? updated : book));
          setFeedback("AI 已完成作品基础信息、核心文件和实体设定生成。");
          return;
        }
        setBooks((current) => current.map((book) =>
          book.id === selectedBookId ? { ...book, initialization: nextInitialization } : book
        ));
        if (nextInitialization?.status === "failed") {
          setFeedback(`AI 作品初始化失败：${nextInitialization.error || "请检查规划模型与运行记录。"}`);
        } else if (nextInitialization?.status === "interrupted") {
          setFeedback("AI 作品初始化已中断/暂停，可以从检查点继续执行。");
        } else if (nextInitialization?.status === "cancelled") {
          setFeedback("AI 作品初始化已取消，可以点击“重试初始化”继续。");
        }
      }).catch((error) => {
        if (!ignore) setFeedback(`AI 初始化状态读取失败：${toMessage(error)}`);
      });
    }, 1_500);
    return () => {
      ignore = true;
      window.clearInterval(timer);
    };
  }, [selectedBook?.initialization?.status, selectedBookId, view]);

  // 订阅初始化运行的 SSE 事件流；runId 变化或手动刷新（streamRefreshKey）时重建订阅。
  useEffect(() => {
    const runId = selectedBook?.initialization?.runId;
    if (view !== "detail" || !runId) {
      setInitializationEvents([]);
      setInitializationStreamError("");
      return;
    }
    let ignore = false;
    let terminal = false;
    let latestEventSeq = -1;
    let snapshotSeq = -1;
    setInitializationEvents([]);
    setInitializationStreamError("");
    const applyRunSnapshot = (snapshot: Awaited<ReturnType<typeof getRun>>) => {
      const status = snapshot.status;
      snapshotSeq = snapshot.lastEventSeq;
      terminal = ["cancelled", "completed", "failed", "interrupted"].includes(status);
      setBooks((current) => current.map((book) => book.id === selectedBookId
        ? {
            ...book,
            initialization: {
              runId: snapshot.id,
              status,
              stage: snapshot.currentStage,
              error: snapshot.error && typeof snapshot.error === "object" && "message" in snapshot.error
                ? String((snapshot.error as { message: unknown }).message)
                : snapshot.error ? String(snapshot.error) : null
            }
          }
        : book
      ));
    };

    // 先取一次快照，再订阅从头重放，确保页面不会遗漏“查询与建立 SSE 连接”之间的事件。
    void getRun(runId).then((snapshot) => {
      // SSE 可能先收到更新事件；过期快照不能把页面状态回退到旧阶段。
      if (!ignore && snapshot.lastEventSeq >= latestEventSeq) applyRunSnapshot(snapshot);
    }).catch(() => {
      if (!ignore) setInitializationStreamError("无法读取执行快照，正在等待实时事件...");
    });

    const unsubscribe = subscribeRunEvents(
      runId,
      (event) => {
        if (ignore) return;
        const isNewEvent = event.seq > latestEventSeq;
        latestEventSeq = Math.max(latestEventSeq, event.seq);
        const isNewerThanSnapshot = isNewEvent && event.seq > snapshotSeq;
        if (isNewerThanSnapshot) {
          if (["run_completed", "run_failed", "run_cancelled", "run_interrupted"].includes(event.type)) {
            terminal = true;
          } else {
            terminal = false;
          }
        }
        if (isNewerThanSnapshot) {
          setBooks((current) => current.map((book) => book.id === selectedBookId
            ? { ...book, initialization: projectInitializationEvent(book.initialization, event) }
            : book
          ));
        }
        setInitializationEvents((current) => {
          if (current.some((item) => item.seq === event.seq)) return current;
          return [...current, event].sort((left, right) => left.seq - right.seq);
        });
        if (isNewerThanSnapshot && ["run_completed", "run_failed", "run_cancelled", "run_interrupted"].includes(event.type)) {
          void getWorkspaceBookDetail(selectedBookId).then((updated) => {
            if (!ignore) setBooks((current) => current.map((book) => book.id === updated.id ? updated : book));
          }).catch(() => {
            // 事件已经能完整展示；作品文件刷新失败时交给下一次状态轮询重试。
          });
        }
      },
      () => {
        if (!ignore && !terminal) setInitializationStreamError("执行事件流已断开，请刷新页面查看最新状态。");
      },
      { afterSeq: -1 }
    );
    return () => {
      ignore = true;
      unsubscribe();
    };
  }, [selectedBook?.initialization?.runId, streamRefreshKey, view]);

  /** 局部更新新建作品表单草稿。 */
  function updateDraft(patch: Partial<BookDraft>) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      ...patch
    }));
  }

  /** 进入新建视图：重置草稿与世界文件读取状态。 */
  function openCreateView() {
    worldFileReadVersion.current += 1;
    setDraft(initialDraft);
    setCreatedDraft(null);
    setActiveDocument(null);
    setWorldFileReading(false);
    setWorldFileError("");
    setView("create");
  }

  /** 回到列表视图：关闭文档弹层。 */
  function openListView() {
    setActiveDocument(null);
    setView("list");
  }

  /** 打开指定作品详情。 */
  function openDetailView(bookId: string) {
    setSelectedBookId(bookId);
    setActiveDocument(null);
    setView("detail");
  }

  /** 选择世界观 md 文件：异步读取正文并写入草稿；用版本号防竞态，避免旧文件覆盖新选择。 */
  function handleWorldFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const readVersion = ++worldFileReadVersion.current;

    if (!file) {
      setWorldFileReading(false);
      setWorldFileError("");
      updateDraft({ worldFileName: "", worldFileContent: "" });
      return;
    }

    setWorldFileReading(true);
    setWorldFileError("");
    updateDraft({ worldFileName: file.name, worldFileContent: "" });

    // 新建作品时需要把用户上传的 world.md 正文写入后端，而不是只记录文件名。
    void file
      .text()
      .then((content) => {
        if (worldFileReadVersion.current !== readVersion) return;
        updateDraft({ worldFileName: file.name, worldFileContent: content });
      })
      .catch(() => {
        if (worldFileReadVersion.current !== readVersion) return;
        setWorldFileError("世界观 Markdown 文件读取失败，请重新选择文件。");
        setFeedback("世界观 Markdown 文件读取失败，请重新选择 .md 文件后再创建作品。");
      })
      .finally(() => {
        if (worldFileReadVersion.current === readVersion) setWorldFileReading(false);
      });
  }

  /** 创建作品：提交草稿，成功后进入详情；失败时保留草稿进入本地预览视图。 */
  async function saveDraft() {
    if (worldFileReading || worldFileError) {
      setFeedback(worldFileError || "正在读取世界观 Markdown，请稍候再创建作品。");
      return;
    }
    setSaving(true);

    try {
      const { book: createdBook, hydrationWarning } = await createWorkspaceBook(draft);
      setBooks((currentBooks) => [createdBook, ...currentBooks.filter((book) => book.id !== createdBook.id)]);
      setSelectedBookId(createdBook.id);
      setCreatedDraft(null);
      if (hydrationWarning) {
        setFeedback(`作品已创建，但详情内容暂时读取失败，请稍后刷新：${hydrationWarning}`);
      } else if (createdBook.initialization?.status === "failed") {
        setFeedback(`作品已创建，但 AI 初始化启动失败：${createdBook.initialization.error || "请重试初始化。"}`);
      } else if (createdBook.initialization && activeInitializationStatuses.has(createdBook.initialization.status)) {
        setFeedback("作品已创建，AI 正在自动生成基础信息、核心文件和实体设定。");
      } else if (createdBook.initialization?.status === "completed") {
        setFeedback("作品已创建，AI 初始化已经完成。");
      } else {
        setFeedback("作品已创建到后端本地 workspace，但 AI 初始化尚未启动。");
      }
      setView("detail");
    } catch (error) {
      setCreatedDraft(draft);
      setFeedback(`后端创建失败，已保留前端预览供检查：${toMessage(error)}`);
      setView("preview");
    } finally {
      setSaving(false);
    }
  }

  /** 重试 AI 初始化：可复用上次检查点继续，成功后重建事件订阅。 */
  async function retryInitialization() {
    if (!selectedBook) return;
    setSaving(true);
    setFeedback("");
    try {
      const initialization = await retryWorkspaceBookInitialization(selectedBook.id);
      setBooks((current) => current.map((book) =>
        book.id === selectedBook.id ? { ...book, initialization } : book
      ));
      setStreamRefreshKey((key) => key + 1);
      setFeedback(initialization.reused ? "已从原运行检查点恢复 AI 初始化。" : "AI 初始化已重新启动。");
    } catch (error) {
      setFeedback(`AI 初始化重试失败：${toMessage(error)}`);
    } finally {
      setSaving(false);
    }
  }

  /** 暂停 AI 初始化：请求后端中止模型调用并保存执行状态。 */
  async function pauseInitialization() {
    const runId = selectedBook?.initialization?.runId;
    if (!runId) return;
    setPausingInitialization(true);
    setFeedback("");
    try {
      await pauseRun(runId);
      setFeedback("已请求暂停，正在中止模型调用并保存执行状态。");
    } catch (error) {
      setFeedback(`AI 初始化暂停失败：${toMessage(error)}`);
    } finally {
      setPausingInitialization(false);
    }
  }

  /** 从当前作品进入章节编辑器，作品 id 通过路由 state 传递。 */
  function continueWriting() {
    navigate("/editor", { state: { fromBookId: selectedBook?.id ?? selectedBookId } });
  }

  /** 删除作品：需用户确认；删除后回到列表并选中剩余首项。 */
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
              <button
                className="primary-button"
                type="button"
                disabled={Boolean(selectedBook?.initialization && activeInitializationStatuses.has(selectedBook.initialization.status))}
                onClick={continueWriting}
              >
                {selectedBook?.initialization && activeInitializationStatuses.has(selectedBook.initialization.status) ? "AI 生成中" : "继续写作"}
              </button>
              <button
                className="danger-button"
                type="button"
                data-loading={saving ? "true" : undefined}
                disabled={saving}
                onClick={() => void deleteSelectedBook()}
              >
                <Trash2 size={16} aria-hidden="true" />
                {saving ? "删除中..." : "删除作品"}
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
          styleVersions={styleVersions}
          onOpenDocument={setActiveDocument}
          onRetryInitialization={() => void retryInitialization()}
          onPauseInitialization={() => void pauseInitialization()}
          retryingInitialization={saving}
          pausingInitialization={pausingInitialization}
          initializationEvents={initializationEvents}
          initializationStreamError={initializationStreamError}
        />
      ) : null}

      {view === "create" ? (
        <CreateBookView
          draft={draft}
          saving={saving}
          worldFileReading={worldFileReading}
          worldFileError={worldFileError}
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

interface BookDetailViewProps {
  book: BookDetail;
  writingStyles: WritingStyle[];
  styleVersions: Map<string, WritingStyleVersionDto>;
  onOpenDocument: (document: DetailDocument) => void;
  onRetryInitialization: () => void;
  onPauseInitialization: () => void;
  retryingInitialization: boolean;
  pausingInitialization: boolean;
  initializationEvents: RunEvent[];
  initializationStreamError: string;
}

/**
 * 作品详情视图：属性、进度、角色/核心文件/世界观 + AI 初始化状态卡（轮询与 SSE 事件）。
 */
function BookDetailView({
  book,
  writingStyles,
  styleVersions,
  onOpenDocument,
  onRetryInitialization,
  onPauseInitialization,
  retryingInitialization,
  pausingInitialization,
  initializationEvents,
  initializationStreamError
}: BookDetailViewProps) {
  const attributeRows = [
    ["作品类型", book.genre],
    ["写作风格", getWritingStyleName(writingStyles, book.writingStyleId) || "AI 自动选择"],
    ["风格版本", getStyleVersionLabel(writingStyles, styleVersions, book.writingStyleId, book.writingStyleVersionId)],
    ["人称", book.attributes.narrationPerspective],
    ["频道", book.attributes.channel],
    ["主角性别", book.attributes.protagonistGender],
    ["主角姓名", book.attributes.protagonistName],
    ["小说计划字数", `${formatNumber(book.attributes.plannedWords)} 字`],
    ["每章节计划字数", `${formatNumber(book.attributes.chapterWords)} 字`],
    ["世界观文件", book.attributes.worldFileName]
  ];

  // 判断初始化是否真的处于“暂停”：向后回查最近一条中断事件，以 payload.paused 为准。
  const isInitializationPaused = useMemo(() => {
    if (book.initialization?.status !== "interrupted") return false;
    for (let index = initializationEvents.length - 1; index >= 0; index -= 1) {
      const event = initializationEvents[index];
      if (event.type === "run_interrupted") return event.payload.paused === true;
    }
    return false;
  }, [book.initialization?.status, initializationEvents]);

  // 初始化状态卡的执行详情（事件列表 + 实时输出）默认收起，通过按钮展开。
  const [initializationDetailsOpen, setInitializationDetailsOpen] = useState(false);

  // 切换到新的 Run 后恢复收起状态，避免沿用上一次 Run 的展开状态。
  useEffect(() => {
    setInitializationDetailsOpen(false);
  }, [book.initialization?.runId]);

  // model_delta 是实时输出的内部增量，不单独作为执行日志展示，避免关键物品等阶段刷出大量无意义行。
  const executionEvents = useMemo(
    () => initializationEvents.filter((event) => event.type !== "model_delta"),
    [initializationEvents]
  );
  const liveOutput = useMemo(() => {
    let previousStage: string | null | undefined;
    return initializationEvents
      .filter((event) => event.type === "model_delta")
      .map((event) => {
        const stage = event.stage ?? null;
        const heading = stage !== previousStage
          ? `\n\n--- ${stage ? initializationStageLabels[stage] ?? stage : "模型输出"} ---\n`
          : "";
        previousStage = stage;
        return heading + String(event.payload.delta ?? "");
      })
      .join("");
  }, [initializationEvents]);

  // 执行详情 / 实时输出自动定位到最新内容；只有用户主动操作过滚动容器后才保留其阅读位置。
  const eventsListRef = useRef<HTMLOListElement | null>(null);
  const liveOutputRef = useRef<HTMLPreElement | null>(null);
  const followEventsRef = useRef(true);
  const followOutputRef = useRef(true);
  const eventsUserInteractionRef = useRef(false);
  const outputUserInteractionRef = useRef(false);
  const eventsScrollFrameRef = useRef<number | null>(null);
  const outputScrollFrameRef = useRef<number | null>(null);
  const updateFollowState = (element: HTMLElement, target: MutableRefObject<boolean>) => {
    target.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
  };
  const markUserInteraction = (target: MutableRefObject<boolean>) => {
    target.current = true;
  };
  const scrollToLatest = (element: HTMLElement) => {
    element.scrollTop = element.scrollHeight;
  };
  useEffect(() => {
    // 切换到新的 Run 后恢复自动跟随，避免沿用上一次 Run 的手动滚动状态。
    eventsUserInteractionRef.current = false;
    outputUserInteractionRef.current = false;
    followEventsRef.current = true;
    followOutputRef.current = true;
  }, [book.initialization?.runId]);
  useLayoutEffect(() => {
    const element = eventsListRef.current;
    if (!element || eventsUserInteractionRef.current || !followEventsRef.current) return;
    scrollToLatest(element);
    if (eventsScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(eventsScrollFrameRef.current);
    }
    eventsScrollFrameRef.current = window.requestAnimationFrame(() => {
      eventsScrollFrameRef.current = null;
      if (!eventsUserInteractionRef.current && followEventsRef.current && eventsListRef.current) {
        scrollToLatest(eventsListRef.current);
      }
    });
    return () => {
      if (eventsScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(eventsScrollFrameRef.current);
        eventsScrollFrameRef.current = null;
      }
    };
  }, [executionEvents.length]);
  useLayoutEffect(() => {
    const element = liveOutputRef.current;
    if (!element || outputUserInteractionRef.current || !followOutputRef.current) return;
    scrollToLatest(element);
    if (outputScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(outputScrollFrameRef.current);
    }
    outputScrollFrameRef.current = window.requestAnimationFrame(() => {
      outputScrollFrameRef.current = null;
      if (!outputUserInteractionRef.current && followOutputRef.current && liveOutputRef.current) {
        scrollToLatest(liveOutputRef.current);
      }
    });
    return () => {
      if (outputScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(outputScrollFrameRef.current);
        outputScrollFrameRef.current = null;
      }
    };
  }, [liveOutput]);

  return (
    <section className="book-detail-view">
      {book.initialization && (book.initialization.status !== "completed" || initializationEvents.length > 0) ? (
        <div className={`book-initialization-status ${book.initialization.status}`} role="status" aria-live="polite">
          <div className="book-initialization-summary">
            <strong>{isInitializationPaused ? "AI 初始化已暂停" : initializationStatusTitle(book.initialization.status)}</strong>
            <span>{book.initialization.stage ? initializationStageLabels[book.initialization.stage] ?? book.initialization.stage : "等待后台任务"}</span>
          </div>
          {book.initialization.error ? <p>{book.initialization.error}</p> : null}
          {activeInitializationStatuses.has(book.initialization.status) ? (
            <button
              className="secondary-button"
              type="button"
              disabled={pausingInitialization}
              onClick={onPauseInitialization}
            >
              {pausingInitialization ? "正在暂停..." : "暂停执行"}
            </button>
          ) : null}
          {["failed", "interrupted", "cancelled"].includes(book.initialization.status) ? (
            <button
              className="secondary-button"
              type="button"
              disabled={retryingInitialization}
              onClick={onRetryInitialization}
            >
              {retryingInitialization ? "正在恢复..." : isInitializationPaused ? "继续执行" : "重试初始化"}
            </button>
          ) : null}
          {initializationEvents.length > 0 ? (
            <button
              className="ghost-button"
              type="button"
              aria-expanded={initializationDetailsOpen}
              onClick={() => setInitializationDetailsOpen((open) => !open)}
            >
              {initializationDetailsOpen ? "收起详情" : "展开详情"}
            </button>
          ) : null}
          {initializationEvents.length > 0 && initializationDetailsOpen ? (
            <div className="book-initialization-detail">
              <div className="book-initialization-detail-title">
                <strong>执行详情</strong>
                <span>{initializationStreamError || `${executionEvents.length} 条执行记录`}</span>
              </div>
              <ol
                className="book-initialization-events"
                ref={eventsListRef}
                onScroll={(event) => updateFollowState(event.currentTarget, followEventsRef)}
                onPointerDown={() => markUserInteraction(eventsUserInteractionRef)}
                onWheel={() => markUserInteraction(eventsUserInteractionRef)}
                onTouchMove={() => markUserInteraction(eventsUserInteractionRef)}
                onKeyDown={() => markUserInteraction(eventsUserInteractionRef)}
                tabIndex={0}
              >
                {executionEvents.map((event) => (
                  <InitializationEventRow key={event.eventId} event={event} />
                ))}
              </ol>
              {liveOutput.trim() ? (
                <div className="book-initialization-live">
                  <div className="book-initialization-detail-title">
                    <strong>实时输出</strong>
                    <span>模型流式返回</span>
                  </div>
                  <pre
                    className="book-initialization-live-text"
                    ref={liveOutputRef}
                    onScroll={(event) => updateFollowState(event.currentTarget, followOutputRef)}
                    onPointerDown={() => markUserInteraction(outputUserInteractionRef)}
                    onWheel={() => markUserInteraction(outputUserInteractionRef)}
                    onTouchMove={() => markUserInteraction(outputUserInteractionRef)}
                    onKeyDown={() => markUserInteraction(outputUserInteractionRef)}
                    tabIndex={0}
                  >
                    {liveOutput.slice(-6000)}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
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

/** 初始化状态 → 顶部标题文案。 */
function initializationStatusTitle(status: NonNullable<BookDetail["initialization"]>["status"]) {
  if (status === "completed") return "AI 初始化已完成";
  if (status === "failed") return "AI 初始化失败";
  if (status === "interrupted") return "AI 初始化已中断";
  if (status === "cancelled" || status === "cancelling") return "AI 初始化已取消";
  if (status === "queued") return "AI 初始化排队中";
  return "AI 正在生成作品信息";
}

/** 把 SSE 事件立即投影到详情页状态，避免等待下一轮轮询才看到阶段和终态变化。 */
function projectInitializationEvent(
  current: BookDetail["initialization"],
  event: RunEvent
): NonNullable<BookDetail["initialization"]> {
  const next = current ?? {
    runId: event.runId,
    status: "queued" as const,
    stage: null,
    error: null
  };

  switch (event.type) {
    case "run_queued":
      return { ...next, runId: event.runId, status: "queued", stage: null, error: null };
    case "run_started":
      return { ...next, runId: event.runId, status: "running", error: null };
    case "stage_started":
    case "stage_progress":
      return { ...next, runId: event.runId, status: "running", stage: event.stage, error: null };
    case "stage_completed":
      return { ...next, runId: event.runId, status: "running", stage: null, error: null };
    case "cancel_requested":
      return { ...next, runId: event.runId, status: "cancelling" };
    case "run_completed":
      return { ...next, runId: event.runId, status: "completed", stage: null, error: null };
    case "run_failed":
      return { ...next, runId: event.runId, status: "failed", stage: null, error: eventErrorMessage(event.payload.error) };
    case "run_cancelled":
      return { ...next, runId: event.runId, status: "cancelled", stage: null, error: null };
    case "run_interrupted":
      return { ...next, runId: event.runId, status: "interrupted", stage: null, error: eventErrorMessage(event.payload.reason) };
    default:
      return next;
  }
}

function eventErrorMessage(value: unknown) {
  if (value && typeof value === "object" && "message" in value) {
    return String((value as { message: unknown }).message);
  }
  return value ? String(value) : null;
}

/** 初始化事件行：按事件类型渲染为可读文案，并决定行内色调。 */
function InitializationEventRow({ event }: { event: RunEvent }) {
  const detail = initializationEventDetail(event);
  return (
    <li className="book-initialization-event" data-tone={detail.tone}>
      <time>{formatEventTime(event.timestamp)}</time>
      <span>{detail.text}</span>
    </li>
  );
}

/** 事件 → 展示文本与色调：逐类型映射，未知类型回退为“stage + 类型名”。 */
function initializationEventDetail(event: RunEvent): { text: string; tone: "normal" | "info" | "success" | "error" } {
  const stage = event.stage ? initializationStageLabels[event.stage] ?? event.stage : "";
  const prefix = stage ? `【${stage}】` : "";
  switch (event.type) {
    case "run_created":
    case "run_queued":
      return { text: "已进入执行队列", tone: "info" };
    case "run_started":
      return { text: "开始执行", tone: "info" };
    case "stage_started":
      return { text: `${prefix}开始执行`, tone: "info" };
    case "stage_completed":
      return { text: `${prefix}执行完成`, tone: "success" };
    case "stage_progress": {
      const message = String(event.payload.message ?? "");
      return { text: message ? `${prefix}${message}` : `${prefix}处理中`, tone: "info" };
    }
    case "model_attempt_started": {
      const purpose = String(event.payload.purpose ?? "生成");
      return { text: `${prefix}模型调用开始（${purpose}）`, tone: "info" };
    }
    case "model_attempt_completed": {
      const succeeded = event.payload.status === "completed";
      const status = succeeded ? "成功" : attemptStatusLabels[String(event.payload.status ?? "结束")] ?? String(event.payload.status ?? "结束");
      const tokens = typeof event.payload.totalTokens === "number" ? `${event.payload.totalTokens} Token` : null;
      const latency = typeof event.payload.latencyMs === "number" ? `${event.payload.latencyMs} ms` : null;
      const suffix = [tokens, latency].filter(Boolean).join(" · ");
      // 失败时展示后端归一化的具体原因与 HTTP 状态码，避免只看到“模型服务暂时不可用”这种笼统文案。
      const error = event.payload.error as { message?: unknown; status?: number | null } | null;
      const errorText = !succeeded && error && typeof error === "object"
        ? `：${String(error.message ?? "未知错误")}${typeof error.status === "number" ? `（HTTP ${error.status}）` : ""}`
        : "";
      return { text: `${prefix}模型调用${status}${suffix ? ` · ${suffix}` : ""}${errorText}`, tone: succeeded ? "success" : "error" };
    }
    case "tool_started": {
      const tool = String(event.payload.tool ?? event.payload.name ?? "");
      return { text: `${prefix}开始调用${tool ? `工具：${tool}` : "工具"}`, tone: "info" };
    }
    case "tool_completed": {
      const tool = String(event.payload.tool ?? event.payload.name ?? "");
      return { text: `${prefix}${tool ? `工具：${tool}` : "工具"}调用完成`, tone: "success" };
    }
    case "model_delta":
      return { text: `${prefix}实时输出已更新`, tone: "info" };
    case "checkpoint_saved":
      return { text: `${prefix}检查点已保存，可中断恢复`, tone: "info" };
    case "degraded":
      return { text: "模型链路降级，已切换备用策略", tone: "error" };
    case "review_completed":
      return { text: `${prefix}审稿完成`, tone: "success" };
    case "cancel_requested":
      return { text: "已请求取消", tone: "error" };
    case "run_completed":
      return { text: "作品信息生成完成", tone: "success" };
    case "run_failed": {
      const error = event.payload.error as { message?: unknown } | null;
      const message = error && typeof error === "object" && "message" in error
        ? String(error.message)
        : String(event.payload.error ?? "未知错误");
      return { text: `执行失败：${message}`, tone: "error" };
    }
    case "run_interrupted":
      return { text: "执行已中断，可点击“重试初始化”从检查点继续", tone: "error" };
    case "run_cancelled":
      return { text: "执行已取消", tone: "error" };
    default:
      return { text: `${prefix}执行状态已更新`, tone: "normal" };
  }
}

/** 事件时间格式化为 HH:mm:ss。 */
function formatEventTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

/** 模型尝试终态的中文标签（与后端 ModelAttempt status 对应）。 */
const attemptStatusLabels: Record<string, string> = {
  completed: "成功",
  failed: "失败",
  cancelled: "已取消",
  timed_out: "超时"
};

interface CreateBookViewProps {
  draft: BookDraft;
  saving: boolean;
  worldFileReading: boolean;
  worldFileError: string;
  writingStyleOptions: ReturnType<typeof createWritingStyleOptions>;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSave: () => void;
  onUpdate: (patch: Partial<BookDraft>) => void;
}

/** 新建作品表单视图：全部字段可选，留空由 AI 自动补全。 */
function CreateBookView({
  draft,
  saving,
  worldFileReading,
  worldFileError,
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
            <button
              className="primary-button"
              type="button"
              data-loading={saving ? "true" : undefined}
              disabled={saving || worldFileReading || Boolean(worldFileError)}
              onClick={onSave}
            >
              {saving ? "正在创建作品..." : worldFileReading ? "正在读取世界观..." : "创建作品"}
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

/** 作品创建预览视图：后端创建失败时的兜底，展示草稿内容与后续生成计划。 */
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

/** 异常归一为可展示的错误文案。 */
function toMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

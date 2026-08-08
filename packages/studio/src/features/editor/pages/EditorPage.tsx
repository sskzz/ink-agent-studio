/**
 * 继续写作页（章节编辑器壳）：双栏布局（左侧功能栏 / 右侧内容区）。
 * 左侧功能栏 = 作品导航（作品信息/正文）+ 底部故事线看板（主体/阶段进度、当前位置、伏笔、角色状态）；
 * 右侧内容区 = 顶部内容面板 + 底部 AI 会话栏（类似 CLI 会话：上方消息、下方输入框），
 * 会话与左侧选中条目一对一绑定并携带内容上下文快照。
 */
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, BookOpenText, CircleDotDashed, Eye, FileText, Flag, FolderOpen, ListTree, MapPin, Package, Plus, Settings2, Tags, UserRound, UsersRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  createContinueRun,
  createChapter,
  deleteChapter,
  getChapter,
  listChapters,
  resolveContinueResult,
  updateChapter
} from "@/features/chapter/api/chapterApi";
import type {
  ChapterContinueResult,
  ChapterDetail,
  ChapterSummary,
  ChapterUpdateInput
} from "@/features/chapter/api/chapterApi";
import { getRun, resumeRun, subscribeRunEvents } from "@/features/runs/api/runsApi";
import type { RunEvent } from "@ink-agent/contracts";
import { getWorkspaceBookDetail } from "@/shared/api/workspaceApi";
import type { WorkspaceBookDetail } from "@/shared/api/workspaceApi";
import { AssistantChat } from "@/features/editor/components/AssistantPanels";
import { EditorMainPanel } from "@/features/editor/components/EditorMainPanel";
import { StorylinePanel } from "@/features/storyline/components/StorylinePanel";
import type { EditorNavGroup, EditorNavItem } from "@/features/editor/types";

type EditorTab = "info" | "chapters";
/** 路由 state：从作品详情“继续写作”进入时携带来源作品 id。 */
interface EditorRouteState {
  fromBookId?: string;
}

/** 章节状态中文标签（导航条目 meta 展示）。 */
const chapterStatusLabels: Record<ChapterSummary["status"], string> = {
  planned: "待写",
  drafting: "写作中",
  reviewed: "已审",
  published: "已发布"
};

/** 左侧顶部 tab 定义：作品信息 / 正文。 */
const editorTabs: Array<{ id: EditorTab; label: string }> = [
  { id: "info", label: "作品信息" },
  { id: "chapters", label: "正文" }
];

/** 切换 tab 时的默认选中项（各 tab 的占位条目 id）。 */
const defaultItemByTab: Record<EditorTab, string> = {
  info: "basic-settings",
  chapters: "chapter-empty"
};

/** 不在作品数据中的特殊导航项：角色管理与“新增势力/地点/物品/章节”入口（暂为页面结构）。 */
const specialEditorItems: Record<string, EditorNavItem> = {
  "manage-characters": {
    icon: UsersRound,
    id: "manage-characters",
    kind: "role-manager",
    summary: "管理主要角色和次要角色，当前只生成页面结构，不执行真实新增。",
    title: "角色"
  },
  "create-chapter": {
    icon: BookOpenText,
    id: "create-chapter",
    kind: "chapter",
    meta: "新建",
    summary: "创建新章节（第 1 卷，章节号自动分配），创建后自动进入编辑。",
    title: "新建章节"
  },
  "create-faction": {
    createDescriptionLabel: "属性描述",
    createNameLabel: "势力名称",
    createPlaceholder: "例如：主角所在组织 / 对立阵营",
    icon: Flag,
    id: "create-faction",
    kind: "create-entity",
    summary: "新增势力设定，后续接入后端后会写入势力 md/json 文件。",
    title: "新增势力"
  },
  "create-location": {
    createDescriptionLabel: "地点描述",
    createNameLabel: "地点名称",
    createPlaceholder: "例如：主城 / 秘密据点",
    icon: MapPin,
    id: "create-location",
    kind: "create-entity",
    summary: "新增地点设定，记录场景气质、可用线索和章节使用限制。",
    title: "新增地点"
  },
  "create-item": {
    createDescriptionLabel: "物品描述",
    createNameLabel: "物品名称",
    createPlaceholder: "例如：关键道具 / 伏笔物品",
    icon: Package,
    id: "create-item",
    kind: "create-entity",
    summary: "新增物品设定，记录关键道具、证物和伏笔回收方式。",
    title: "新增物品"
  }
};

/** 展平导航分组，便于在当前 tab 的条目中查找激活项。 */
function flattenGroups(groups: EditorNavGroup[]) {
  return groups.flatMap((group) => group.items);
}

/** 数字千分位格式化，用于字数展示。 */
function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

/** 与后端章节字数统计保持一致：去掉所有空白字符后计数。 */
function countContentWords(content: string) {
  return content.replace(/\s+/g, "").length;
}

/** 核心文件 → 导航项：以详情面板展示文件名、摘要与 markdown 正文。 */
function createFileNavItem(file: WorkspaceBookDetail["coreFiles"][number], icon: LucideIcon): EditorNavItem {
  return {
    fields: [
      { label: "文件", value: file.fileName },
      { label: "摘要", value: file.summary || "暂无摘要" }
    ],
    icon,
    id: `core-${file.id}`,
    kind: "detail",
    meta: file.fileName,
    paragraphs: [file.markdown || "暂无 Markdown 内容。"],
    summary: file.summary || "后端暂未返回该文件摘要。",
    title: file.title
  };
}

/** 势力/地点/物品 → 导航项：实体为空时生成占位空态条目。 */
function createEntityNavItems(
  entities: WorkspaceBookDetail["factions"],
  icon: LucideIcon,
  empty: { id: string; title: string; summary: string }
): EditorNavItem[] {
  if (entities.length === 0) {
    return [{
      icon,
      id: empty.id,
      kind: "empty",
      meta: "暂无数据",
      paragraphs: [`AI 初始化完成后会在这里显示${empty.title}设定。`],
      summary: empty.summary,
      title: empty.title
    }];
  }
  return entities.map((entity) => ({
    fields: [
      { label: "定位", value: entity.role || "未分类" },
      { label: "描述", value: entity.description || "暂无描述" }
    ],
    icon,
    id: `${entity.entityType}-${entity.id}`,
    kind: "detail",
    meta: entity.role || "AI 生成",
    paragraphs: [entity.markdown],
    summary: entity.description || `${entity.name}的作品设定。`,
    title: entity.name
  }));
}

/**
 * 章节 → 导航分组：按卷分组，组内按章节号排序；
 * 每个条目携带 chapterId 供点击时加载章节详情，meta 展示状态与字数。
 */
function createChapterNavGroups(chapters: ChapterSummary[]): EditorNavGroup[] {
  if (chapters.length === 0) {
    return [{
      id: "chapters",
      title: "章节",
      addItemId: "create-chapter",
      items: [{
        icon: BookOpenText,
        id: "chapter-empty",
        kind: "empty",
        meta: "暂无章节",
        paragraphs: ["点击章节分组右上角的 + 新建第一个章节。"],
        summary: "章节正文与续写入口。",
        title: "章节"
      }]
    }];
  }

  const volumeNumbers = [...new Set(chapters.map((chapter) => chapter.volumeNo))].sort((left, right) => left - right);
  return volumeNumbers.map((volumeNo) => ({
    id: `chapters-v${volumeNo}`,
    title: `第 ${volumeNo} 卷`,
    addItemId: "create-chapter",
    items: chapters
      .filter((chapter) => chapter.volumeNo === volumeNo)
      .sort((left, right) => left.chapterNo - right.chapterNo)
      .map((chapter) => ({
        chapterId: chapter.id,
        icon: BookOpenText,
        id: `chapter-${chapter.id}`,
        kind: "chapter",
        meta: `${chapterStatusLabels[chapter.status]} · ${formatNumber(chapter.wordCount)} 字`,
        summary: chapter.outline || chapter.summary || "暂无细纲，点击后在编辑面板填写。",
        title: `${chapter.chapterNo}. ${chapter.title}`
      }))
  }));
}

/** 依据作品详情与章节列表动态生成各 tab 的完整导航树（含空态与占位条目）。 */
function createBookAwareNavigation(book: WorkspaceBookDetail, chapters: ChapterSummary[]): Record<EditorTab, EditorNavGroup[]> {
  const outlineFile = book.coreFiles.find((file) => file.id === "outline");
  const briefFile = book.coreFiles.find((file) => file.id === "brief");
  const coreFileItems: EditorNavItem[] = book.coreFiles.length > 0
    ? book.coreFiles.map((file) => createFileNavItem(file, file.id === "outline" ? ListTree : FileText))
    : [
        {
          icon: FileText,
          id: "core-empty",
          kind: "empty",
          meta: "暂无文件",
          paragraphs: ["后端暂未返回核心文件。"],
          summary: "后端暂未返回故事基石、卷纲规划、当前状态或伏笔池。",
          title: "核心文件"
        }
      ];

  const characterItems: EditorNavItem[] = book.characters.length > 0
    ? book.characters.map((character) => ({
        fields: [
          { label: "角色类型", value: `${character.role}角色` },
          { label: "角色定位", value: character.identity }
        ],
        icon: UserRound,
        id: `character-${character.id}`,
        kind: "detail",
        meta: `${character.role}角色`,
        paragraphs: [character.markdown || "暂无角色 Markdown 内容。"],
        summary: character.identity || "后端暂未返回角色定位。",
        title: character.name
      }))
    : [
        {
          icon: UsersRound,
          id: "characters-empty",
          kind: "empty",
          meta: "暂无角色",
          paragraphs: ["后端暂未返回角色列表。点击加号可进入角色新增页面结构。"],
          summary: "暂无角色数据。",
          title: "角色"
        }
      ];

  return {
    info: [
      {
        id: "theme",
        title: "主题",
        items: [
          {
            fields: [
              { label: "作品名称", value: book.title },
              { label: "作品类型", value: book.genre || "AI 自动生成" }
            ],
            icon: Tags,
            id: "tags",
            kind: "detail",
            meta: "后端作品",
            paragraphs: ["标签和关键词接口暂未接入，当前仅展示后端已返回的作品名称与类型。"],
            summary: "作品关键词、题材和内容方向。",
            title: "标签"
          },
          {
            fields: [
              { label: "文件", value: briefFile?.fileName ?? "brief.md" },
              { label: "摘要", value: briefFile?.summary ?? "暂无摘要" }
            ],
            icon: FileText,
            id: "brief",
            kind: "detail",
            meta: briefFile?.fileName ?? "暂无文件",
            paragraphs: [book.brief || "后端暂未返回故事基石内容。"],
            summary: "作品简介、卖点和读者承诺。",
            title: "简介"
          },
          {
            fields: [
              { label: "文件", value: outlineFile?.fileName ?? "outline.md" },
              { label: "摘要", value: outlineFile?.summary ?? "暂无摘要" }
            ],
            icon: ListTree,
            id: "outline",
            kind: outlineFile ? "detail" : "empty",
            meta: outlineFile?.fileName ?? "暂无文件",
            paragraphs: [outlineFile?.markdown ?? "后端暂未返回卷纲规划内容。"],
            summary: "主线规划、卷纲和伏笔回收节奏。",
            title: "总纲"
          }
        ]
      },
      {
        id: "settings",
        title: "设置",
        items: [
          {
            fields: [
              { label: "作品名称", value: book.title },
              { label: "人称", value: book.attributes.narrationPerspective },
              { label: "频道", value: book.attributes.channel },
              { label: "主角性别", value: book.attributes.protagonistGender },
              { label: "主角姓名", value: book.attributes.protagonistName },
              {
                label: "小说计划字数",
                value: book.attributes.plannedWords ? `${formatNumber(book.attributes.plannedWords)} 字` : "AI 自动生成",
                hint: "未填写时由 AI 根据题材估算。"
              },
              {
                label: "每章节计划字数",
                value: book.attributes.chapterWords ? `${formatNumber(book.attributes.chapterWords)} 字` : "AI 自动生成",
                hint: "未填写时由 AI 按节奏补全。"
              },
              { label: "写作风格", value: book.writingStyleId || "AI 自动选择" },
              { label: "世界观文件", value: book.attributes.worldFileName }
            ],
            icon: Settings2,
            id: "basic-settings",
            kind: "detail",
            meta: "后端作品详情",
            paragraphs: ["这里展示后端作品详情返回的基础属性；未填写字段由后续 AI 初始化流程补全。"],
            summary: "人称、频道、主角、字数计划与风格配置。",
            title: "基础设置"
          }
        ]
      },
      {
        id: "core-files",
        title: "核心文件",
        items: coreFileItems
      },
      {
        id: "characters",
        title: "角色",
        addItemId: "manage-characters",
        items: characterItems
      },
      {
        id: "background",
        title: "背景",
        items: [
          {
            fields: [
              { label: "文件", value: book.worldview.fileName },
              { label: "摘要", value: book.worldview.summary || "暂无摘要" }
            ],
            icon: FolderOpen,
            id: "background-world",
            kind: "detail",
            meta: book.worldview.fileName,
            paragraphs: [book.worldview.markdown || "后端暂未返回世界观内容。"],
            summary: "故事发生的时代、地点和世界规则。",
            title: "背景"
          }
        ]
      },
      {
        id: "faction",
        title: "势力",
        addItemId: "create-faction",
        items: createEntityNavItems(book.factions, Flag, { id: "faction-empty", title: "势力", summary: "组织、阵营和关系网。" })
      },
      {
        id: "locations",
        title: "地点",
        addItemId: "create-location",
        items: createEntityNavItems(book.locations, MapPin, { id: "locations-empty", title: "地点", summary: "关键场景和可用线索。" })
      },
      {
        id: "items",
        title: "物品",
        addItemId: "create-item",
        items: createEntityNavItems(book.items, Package, { id: "items-empty", title: "物品", summary: "关键道具、信件和证物。" })
      }
    ],
    chapters: createChapterNavGroups(chapters)
  };
}

/** 继续写作页主组件：加载来源作品详情并组装编辑器三栏视图。 */
export function EditorPage() {
  const location = useLocation();
  // “继续写作”直接进入正文与当前章节；作品信息仍可从左侧 tab 查看。
  const [activeTab, setActiveTab] = useState<EditorTab>("chapters");
  const [activeItemId, setActiveItemId] = useState(defaultItemByTab.chapters);
  const [isScrollbarVisible, setIsScrollbarVisible] = useState(false);
  const [isBookLoading, setIsBookLoading] = useState(false);
  const [bookDetail, setBookDetail] = useState<WorkspaceBookDetail | null>(null);
  const [bookLoadMessage, setBookLoadMessage] = useState("");
  // 章节状态：列表、当前编辑章节、加载/保存/续写/删除标记、续写结果与内联错误
  const [chapters, setChapters] = useState<ChapterSummary[]>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [activeChapter, setActiveChapter] = useState<ChapterDetail | null>(null);
  const [chapterLoading, setChapterLoading] = useState(false);
  const [chapterSaving, setChapterSaving] = useState(false);
  const [chapterContinuing, setChapterContinuing] = useState(false);
  const [chapterDeleting, setChapterDeleting] = useState(false);
  const [continueResult, setContinueResult] = useState<ChapterContinueResult | null>(null);
  const [chapterError, setChapterError] = useState<string | null>(null);
  const [chapterMessage, setChapterMessage] = useState("");
  // 异步续写 Run 状态：runId + 状态 + SSE 实时正文增量（供实时流与断点续写）
  const [continueRun, setContinueRun] = useState<{
    runId: string;
    chapterId: string;
    status: "running" | "interrupted" | "failed" | "completed";
    draft: string;
    error: string | null;
  } | null>(null);
  const [streamRefreshKey, setStreamRefreshKey] = useState(0);
  // 最近一次续写指令与重试计数：模型服务临时故障（账号池/限流）时自动重试一次
  const [lastContinueInstruction, setLastContinueInstruction] = useState("");
  const [continueRetries, setContinueRetries] = useState(0);
  const scrollbarTimerRef = useRef<number | null>(null);
  // SSE 回调不会因章节切换重建，使用 ref 判断结果是否仍属于当前章节。
  const activeChapterIdRef = useRef<string | null>(null);

  const routeState = location.state as EditorRouteState | null;
  const backBookId = routeState?.fromBookId ?? "";
  const backLinkState = backBookId ? { bookId: backBookId, view: "detail" } : undefined;

  useEffect(() => {
    activeChapterIdRef.current = activeChapter?.id ?? null;
  }, [activeChapter?.id]);

  // 卸载时清理滚动条显隐的延时器，避免组件销毁后仍触发 setState。
  useEffect(() => {
    return () => {
      if (scrollbarTimerRef.current !== null) {
        window.clearTimeout(scrollbarTimerRef.current);
      }
    };
  }, []);

  // 根据路由 state 的来源作品 id 拉取详情；无 id 时给出引导提示。
  useEffect(() => {
    let ignore = false;

    async function loadBookDetail() {
      setBookLoadMessage("");
      setBookDetail(null);

      if (!backBookId) {
        setIsBookLoading(false);
        setBookLoadMessage("请从作品详情页点击“继续写作”进入编辑器。");
        return;
      }

      try {
        setIsBookLoading(true);
        const detail = await getWorkspaceBookDetail(backBookId);

        if (!ignore) {
          setBookDetail(detail);
        }
      } catch (error) {
        if (!ignore) {
          setBookDetail(null);
          setBookLoadMessage(`作品详情读取失败：${toMessage(error)}`);
        }
      } finally {
        if (!ignore) {
          setIsBookLoading(false);
        }
      }
    }

    void loadBookDetail();

    return () => {
      ignore = true;
    };
  }, [backBookId]);

  // 作品详情加载成功后并行拉取章节列表（详情刷新时 id 不变不会重复触发）。
  useEffect(() => {
    if (!bookDetail) return;
    const currentBookId = bookDetail.id;
    let ignore = false;

    async function loadChapters() {
      setChaptersLoading(true);
      setChapterMessage("");
      try {
        const list = await listChapters(currentBookId);
        if (!ignore) setChapters(list);
      } catch (error) {
        if (!ignore) setChapterMessage(`章节列表读取失败：${toMessage(error)}`);
      } finally {
        if (!ignore) setChaptersLoading(false);
      }
    }

    void loadChapters();
    return () => {
      ignore = true;
    };
  }, [bookDetail?.id]);

  /** 鼠标移动/滚动时短暂显示滚动条，900ms 后自动隐藏。 */
  function revealScrollbar() {
    setIsScrollbarVisible(true);

    if (scrollbarTimerRef.current !== null) {
      window.clearTimeout(scrollbarTimerRef.current);
    }

    scrollbarTimerRef.current = window.setTimeout(() => {
      setIsScrollbarVisible(false);
    }, 900);
  }

  /** 切换顶部 tab：同时重置该 tab 的默认选中项。 */
  function switchTab(tab: EditorTab) {
    setActiveTab(tab);
    setActiveItemId(defaultItemByTab[tab]);
  }

  /** 打开章节：加载详情并选中（重复点击同一章节时跳过重复请求）。 */
  async function openChapter(chapterId: string) {
    if (!bookDetail || activeChapter?.id === chapterId) return;
    setContinueResult(null);
    setChapterError(null);
    setChapterLoading(true);
    setChapterMessage("");
    try {
      const detail = await getChapter(bookDetail.id, chapterId);
      setActiveChapter(detail);
    } catch (error) {
      setChapterError(`章节详情读取失败：${toMessage(error)}`);
    } finally {
      setChapterLoading(false);
    }
  }

  // 首次打开“正文”或章节列表刷新后，自动定位作品当前章节并加载详情。
  // 新建入口是一次性动作，不能被这个同步选择逻辑抢先改回当前章节。
  useEffect(() => {
    if (activeTab !== "chapters" || !bookDetail || chapters.length === 0 || activeItemId === "create-chapter") return;
    const selectedChapter = chapters.find((chapter) => activeItemId === `chapter-${chapter.id}`);
    if (selectedChapter) {
      if (activeChapter?.id !== selectedChapter.id) void openChapter(selectedChapter.id);
      return;
    }

    const currentChapter = chapters.find((chapter) => chapter.id === bookDetail.progress.currentChapterId)
      ?? [...chapters].sort((left, right) => right.volumeNo - left.volumeNo || right.chapterNo - left.chapterNo)[0];
    if (!currentChapter) return;
    setActiveItemId(`chapter-${currentChapter.id}`);
    if (activeChapter?.id !== currentChapter.id) void openChapter(currentChapter.id);
  }, [activeChapter?.id, activeItemId, activeTab, bookDetail, chapters]);

  // "新建章节"入口：activeItemId 变为 create-chapter 时自动创建并选中新章节。
  useEffect(() => {
    if (activeItemId !== "create-chapter" || !bookDetail) return;
    let cancelled = false;
    setChapterSaving(true);
    setChapterMessage("");
    setChapterError(null);
    createChapter(bookDetail.id, { title: "新章节" })
      .then(async (created) => {
        if (cancelled) return;
        setActiveChapter(created);
        setChapters(await listChapters(bookDetail.id));
        setActiveItemId(`chapter-${created.id}`);
        setChapterMessage(`已创建章节：第 ${created.chapterNo} 章 ${created.title}`);
      })
      .catch((error) => {
        if (!cancelled) setChapterError(`新建章节失败：${toMessage(error)}`);
      })
      .finally(() => {
        if (!cancelled) setChapterSaving(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeItemId, bookDetail?.id]);

  /** 保存章节：提交编辑草稿并刷新章节列表与作品进度。 */
  async function saveActiveChapter(patch: ChapterUpdateInput) {
    if (!bookDetail || !activeChapter) return;
    setChapterSaving(true);
    setChapterError(null);
    setChapterMessage("");
    try {
      const updated = await updateChapter(bookDetail.id, activeChapter.id, patch);
      setActiveChapter(updated);
      setChapters(await listChapters(bookDetail.id));
      // 采纳保存成功：清空结果面板与生成状态，界面回到章节展示（正文已更新）
      setContinueResult(null);
      setContinueRun(null);
      setChapterMessage("章节已保存。");
      // 刷新作品详情以同步顶部栏的字数 / 章节进度
      const refreshed = await getWorkspaceBookDetail(bookDetail.id);
      setBookDetail(refreshed);
    } catch (error) {
      setChapterError(`保存失败：${toMessage(error)}`);
    } finally {
      setChapterSaving(false);
    }
  }

  /** 生成完成后重新读取章节索引与正文详情，拿到后端回填的细纲和最新字数。 */
  async function refreshChapterAfterGeneration(chapterId: string) {
    if (!bookDetail) return;
    try {
      const [detail, list] = await Promise.all([
        getChapter(bookDetail.id, chapterId),
        listChapters(bookDetail.id)
      ]);
      setChapters(list);
      // 生成期间允许用户切换章节，不能用后台结果覆盖当前正在查看的章节。
      setActiveChapter((current) => current?.id === chapterId ? detail : current);
    } catch (error) {
      setChapterMessage(`生成已完成，但章节刷新失败：${toMessage(error)}`);
    }
  }

  /**
   * 异步续写：创建 continue_chapter Run 并经 SSE 订阅实时事件——
   * model_delta 累积为实时正文流；中断/失败可"断点续写"（resume 从检查点继续）；
   * 完成时从事件 output 解析最终草稿（结构异常时回退读取 run 快照）。
   */
  async function continueActiveChapter(instruction: string) {
    if (!bookDetail || !activeChapter) return;
    setChapterContinuing(true);
    setContinueResult(null);
    setChapterError(null);
    setChapterMessage("");
    setLastContinueInstruction(instruction);
    setContinueRetries(0);
    try {
      const { runId } = await createContinueRun(bookDetail.id, activeChapter.id, { instruction });
      setContinueRun({ runId, chapterId: activeChapter.id, status: "running", draft: "", error: null });
      setStreamRefreshKey((key) => key + 1);
    } catch (error) {
      setChapterError(`AI 生成启动失败：${toMessage(error)}`);
    } finally {
      setChapterContinuing(false);
    }
  }

  /** 断点续写：恢复中断的续写 Run（从最后检查点继续执行，跳过已完成阶段）。 */
  async function resumeContinueRun() {
    if (!bookDetail || !continueRun) return;
    setChapterContinuing(true);
    setChapterError(null);
    try {
      await resumeRun(continueRun.runId);
      setContinueRun((current) => current ? { ...current, status: "running", draft: "", error: null } : current);
      setStreamRefreshKey((key) => key + 1);
    } catch (error) {
      setChapterError(`断点续写失败：${toMessage(error)}`);
    } finally {
      setChapterContinuing(false);
    }
  }

  // 续写 Run 的 SSE 订阅：runId/状态变化时重建（含断线重连语义：EventSource 按 seq 续接）
  useEffect(() => {
    if (!continueRun || continueRun.status !== "running" || !bookDetail) return;
    let ignore = false;

    const handleEvent = (event: RunEvent) => {
      if (ignore) return;
      switch (event.type) {
        case "model_delta":
          setContinueRun((current) => current
            ? { ...current, draft: current.draft + String(event.payload.delta ?? "") }
            : current);
          break;
        case "run_interrupted":
          setContinueRun((current) => current ? { ...current, status: "interrupted" } : current);
          break;
        case "run_failed": {
          const message = typeof event.payload.error === "object" && event.payload.error !== null
            ? String((event.payload.error as { message?: unknown }).message ?? "未知错误")
            : String(event.payload.error ?? "未知错误");
          // 模型服务临时故障（账号池/限流等）：自动重试一次（失败发生在请求前，不浪费 token）
          if (isRetryableRunError(message) && continueRetries < 1 && bookDetail && activeChapter) {
            setContinueRetries((count) => count + 1);
            const retryChapterId = continueRun.chapterId;
            setContinueRun((current) => current ? { ...current, status: "running", draft: "", error: null } : current);
            void createContinueRun(bookDetail.id, retryChapterId, { instruction: lastContinueInstruction })
              .then(({ runId }) => setContinueRun({ runId, chapterId: retryChapterId, status: "running", draft: "", error: null }))
              .catch((error) => setChapterError(`自动重试启动失败：${toMessage(error)}`));
            setStreamRefreshKey((key) => key + 1);
            break;
          }
          setContinueRun((current) => current ? { ...current, status: "failed", error: message } : current);
          // 失败原因同时传导到面板内联错误区（此前仅存在 continueRun.error，界面不可见）
          setChapterError(`AI 生成失败：${message}${continueRetries >= 1 ? "（已自动重试一次）" : ""}`);
          break;
        }
        case "run_completed": {
          setContinueRun((current) => current ? { ...current, status: "completed" } : current);
          // 输出在事件 payload 中；结构异常时回退读取 run 快照（快照字段为 output）
          const result = resolveContinueResult(event.payload.output);
          if (result) {
            if (!result.chapterId || activeChapterIdRef.current === result.chapterId) {
              setContinueResult(result);
            }
            void refreshChapterAfterGeneration(result.chapterId ?? continueRun.chapterId);
          } else if (bookDetail && continueRun) {
            void getRun(continueRun.runId).then((snapshot) => {
              const fallback = resolveContinueResult((snapshot as { output?: unknown }).output);
              if (fallback) {
                if (!fallback.chapterId || activeChapterIdRef.current === fallback.chapterId) {
                  setContinueResult(fallback);
                }
                void refreshChapterAfterGeneration(fallback.chapterId ?? continueRun.chapterId);
              } else {
                setChapterError("AI 生成已完成，但结果解析失败：请检查章节内容后重试。");
              }
            }).catch(() => {
              setChapterError("AI 生成已完成，但运行结果读取失败，请重试。");
            });
          } else {
            setChapterError("AI 生成已完成，但结果解析失败：请重试。");
          }
          break;
        }
        default:
          break;
      }
    };

    const unsubscribe = subscribeRunEvents(
      continueRun.runId,
      handleEvent,
      () => {
        if (!ignore && continueRun.status === "running") {
          setChapterMessage("生成事件流已断开，正在等待重连...");
        }
      },
      { afterSeq: -1 }
    );
    return () => {
      ignore = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continueRun?.runId, continueRun?.status, streamRefreshKey, bookDetail?.id]);

  /** 删除章节：删除后刷新列表并回到章节空态（已发布章节会被后端拒绝）。 */
  async function deleteActiveChapter() {
    if (!bookDetail || !activeChapter) return;
    setChapterDeleting(true);
    setChapterError(null);
    setChapterMessage("");
    try {
      await deleteChapter(bookDetail.id, activeChapter.id);
      setActiveChapter(null);
      setContinueResult(null);
      setChapters(await listChapters(bookDetail.id));
      setActiveItemId("chapter-empty");
      setChapterMessage("章节已删除。");
      // 刷新作品详情以同步顶部栏的字数 / 章节进度
      const refreshed = await getWorkspaceBookDetail(bookDetail.id);
      setBookDetail(refreshed);
    } catch (error) {
      setChapterError(`删除失败：${toMessage(error)}`);
    } finally {
      setChapterDeleting(false);
    }
  }

  // 作品未加载完成时的占位视图：仅展示退出链接与加载/空状态说明。
  if (isBookLoading || !bookDetail) {
    return (
      <div className="page novel-editor-page">
        <header className="novel-editor-topbar">
          <Link
            className="novel-editor-back"
            to="/workspace"
            state={backLinkState}
            aria-label="退出继续写作页面并返回作品详情"
          >
            <ArrowLeft size={15} />
            <span>退出</span>
          </Link>

          <div className="novel-editor-book-meta" aria-label="作品基础状态">
            <strong>{isBookLoading ? "正在读取作品" : "未选择作品"}</strong>
            {bookLoadMessage ? <span>{bookLoadMessage}</span> : <span>正在从后端读取作品详情...</span>}
          </div>
        </header>

        <div className="novel-editor-frame">
          <main className="novel-editor-center" aria-label="继续写作空状态">
            <article className="novel-editor-card">
              <header className="novel-editor-card-head">
                <div>
                  <h2>{isBookLoading ? "正在加载作品上下文" : "暂无可编辑作品"}</h2>
                  <p>
                    {isBookLoading
                      ? "正在读取后端作品详情、核心文件和基础属性。"
                      : "继续写作页需要从作品详情进入；如果作品接口返回为空，这里不会再显示前端示例数据。"}
                  </p>
                </div>
              </header>
              <div className="novel-editor-card-body empty">
                <div className="novel-editor-empty">
                  <CircleDotDashed size={18} />
                  <strong>{isBookLoading ? "读取中" : "没有作品数据"}</strong>
                  <p>{bookLoadMessage || "请回到作品库创建或选择一本作品后，再点击“继续写作”。"}</p>
                </div>
              </div>
            </article>
          </main>
        </div>
      </div>
    );
  }

  // 当前激活项：优先当前 tab 列表内匹配，其次特殊条目，最后回退首个条目。
  const navigation = createBookAwareNavigation(bookDetail, chapters);
  const currentGroups = navigation[activeTab];
  const currentItems = flattenGroups(currentGroups);
  const activeItem = currentItems.find((item) => item.id === activeItemId) ?? specialEditorItems[activeItemId] ?? currentItems[0] ?? navigation.info[0].items[0];

  // 选中的章节条目：从导航树中定位（kind=chapter 且 id 匹配），用于中央面板分发。
  const selectedChapterItem = currentItems.find((item) => item.kind === "chapter" && item.id === activeItemId);
  const selectedChapter = selectedChapterItem?.chapterId === activeChapter?.id ? activeChapter : null;

  // 最新章节判定：全书卷号最大、章节号最大的章节（排序后取末位），
  // 只有最新章节显示"重新生成整章"按钮。
  const latestChapter = [...chapters].sort(
    (left, right) => right.volumeNo - left.volumeNo || right.chapterNo - left.chapterNo
  )[0];
  const isLatestChapter = Boolean(selectedChapter && latestChapter && selectedChapter.id === latestChapter.id);
  const displayedCurrentChapter = selectedChapter
    ?? chapters.find((chapter) => chapter.id === bookDetail.progress.currentChapterId)
    ?? latestChapter;
  const currentChapterLabel = displayedCurrentChapter
    ? `${displayedCurrentChapter.chapterNo}. ${displayedCurrentChapter.title}`
    : "尚未开始正文写作";

  // AI 会话上下文快照：选中条目（含章节正文/设定 markdown）截断后随消息持久化，
  // 供 AI 会话深度绑定使用；切换条目或章节内容变化时自动更新。
  // 注意：这里用普通计算而非 useMemo——本组件在加载完成前有条件早退（return 空状态），
  // 在早退之后调用任何 Hook 都会违反 React Hooks 规则导致运行时崩溃白屏；
  // 每次渲染对 3000 字符上限做一次 slice，开销可忽略。
  const itemChatContext = (() => {
    let content = "";
    if (activeItem.kind === "chapter") {
      content = selectedChapter?.content ?? "";
    } else {
      content = activeItem.paragraphs?.[0] ?? "";
    }
    return {
      itemId: activeItem.id,
      itemTitle: activeItem.title,
      contentPreview: content.slice(0, 3000),
      contentWordCount: countContentWords(content),
      contentTruncated: content.length > 3000
    };
  })();
  const isActiveChapterRun = Boolean(
    continueRun && selectedChapter && continueRun.chapterId === selectedChapter.id
  );
  const visibleContinueResult = continueResult
    && (!continueResult.chapterId || continueResult.chapterId === selectedChapter?.id)
    ? continueResult
    : null;

  return (
    <div
      className={`page novel-editor-page${isScrollbarVisible ? " scrollbar-visible" : ""}`}
      onMouseMove={revealScrollbar}
      onScrollCapture={revealScrollbar}
    >
      <header className="novel-editor-topbar">
        <Link
          className="novel-editor-back"
          to="/workspace"
          state={backLinkState}
          aria-label="退出继续写作页面并返回作品详情"
        >
          <ArrowLeft size={15} />
          <span>退出</span>
        </Link>

        <div className="novel-editor-book-meta" aria-label="作品基础状态">
          <strong>{bookDetail.title}</strong>
          <span>{bookDetail.attributes.narrationPerspective}</span>
          <span>{bookDetail.attributes.channel}</span>
          <span>已保存到本地</span>
          <span>当前章节：{currentChapterLabel}</span>
          <span>本章计划：{bookDetail.attributes.chapterWords ? formatNumber(bookDetail.attributes.chapterWords) : "AI 自动生成"}</span>
          <span>总字数：{formatNumber(bookDetail.progress.writtenWords)}</span>
          {chapterMessage ? <span className="novel-editor-book-meta-message">{chapterMessage}</span> : null}
          {bookLoadMessage ? <span>{bookLoadMessage}</span> : null}
        </div>
      </header>

      <div className="novel-editor-frame">
        <aside className="novel-editor-left" aria-label="作品属性导航">
          <div className="novel-editor-tabs" role="tablist" aria-label="编辑区域">
            {editorTabs.map((tab) => (
              <button
                className={activeTab === tab.id ? "active" : ""}
                key={tab.id}
                type="button"
                onClick={() => switchTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="novel-editor-nav-scroll">
            {chaptersLoading && activeTab === "chapters" ? (
              <div className="novel-editor-nav-loading">正在读取章节列表...</div>
            ) : null}
            {currentGroups.map((group) => (
              <section className="novel-editor-nav-group" key={group.id}>
                <div className="novel-editor-nav-head">
                  <strong>{group.title}</strong>
                  {group.addItemId ? (
                    <button
                      type="button"
                      onClick={() => setActiveItemId(group.addItemId!)}
                      aria-label={`新增${group.title}`}
                    >
                      <Plus size={14} />
                    </button>
                  ) : null}
                </div>
                <div className="novel-editor-nav-list">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        className={activeItem.id === item.id ? "active" : ""}
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setActiveItemId(item.id);
                          if (item.chapterId) void openChapter(item.chapterId);
                        }}
                      >
                        <span>
                          <Icon size={14} />
                          {item.title}
                        </span>
                        {item.meta ? <small>{item.meta}</small> : <Eye size={13} />}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          {activeTab === "chapters" ? <StorylinePanel bookId={bookDetail.id} /> : null}
        </aside>

        <main className="novel-editor-center" aria-label="当前作品内容与 AI 会话">
          <div className="novel-editor-workspace">
            <EditorMainPanel
              item={activeItem}
              chapter={selectedChapter}
              chapterLoading={selectedChapterItem ? chapterLoading : undefined}
              chapterSaving={chapterSaving}
              chapterContinuing={chapterContinuing || (isActiveChapterRun && continueRun?.status === "running")}
              chapterDeleting={chapterDeleting}
              isLatestChapter={isLatestChapter}
              continueResult={visibleContinueResult}
              chapterError={chapterError}
              streamedDraft={isActiveChapterRun ? continueRun?.draft ?? "" : ""}
              runInterrupted={Boolean(isActiveChapterRun && (continueRun?.status === "interrupted" || continueRun?.status === "failed"))}
              onSaveChapter={(patch) => void saveActiveChapter(patch)}
              onContinueChapter={(instruction) => void continueActiveChapter(instruction)}
              onResumeChapter={() => void resumeContinueRun()}
              onDeleteChapter={() => void deleteActiveChapter()}
              onDismissContinueResult={() => setContinueResult(null)}
            />
          </div>

          <div className="novel-editor-chat" aria-label="AI 对话">
            <AssistantChat
              bookId={bookDetail.id}
              itemId={activeItem.id}
              itemTitle={activeItem.title}
              context={itemChatContext}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

/** 异常归一为可展示的错误文案。 */
function toMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

/** 可自动重试的模型服务临时错误：账号池不可用、限流、负载过高等。 */
function isRetryableRunError(message: string) {
  return /暂时不可用|No available accounts|insufficient balance|rate limit|负载|过载/i.test(message);
}

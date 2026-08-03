/**
 * 继续写作页（章节编辑器壳）：三栏布局（作品导航 / 内容面板 / AI 辅助）。
 * 作品详情从路由 state 的 fromBookId 加载；左侧导航树按 tab 分组，
 * 由作品数据动态生成（createBookAwareNavigation），暂未接入章节正文真实接口。
 */
import type { LucideIcon } from "lucide-react";
import { Archive, ArrowLeft, BookOpenText, ChevronLeft, ChevronRight, CircleDotDashed, Eye, FileText, Flag, FolderOpen, Layers3, ListTree, MapPin, Package, Plus, Settings2, Tags, UserRound, UsersRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { getWorkspaceBookDetail } from "@/shared/api/workspaceApi";
import type { WorkspaceBookDetail } from "@/shared/api/workspaceApi";
import { AssistantChat, InspirationPanel } from "@/features/editor/components/AssistantPanels";
import { EditorMainPanel } from "@/features/editor/components/EditorMainPanel";
import type { EditorField, EditorNavGroup, EditorNavItem } from "@/features/editor/types";

type EditorTab = "info" | "chapters" | "drafts";
type AssistantTab = "chat" | "inspiration";
/** 路由 state：从作品详情“继续写作”进入时携带来源作品 id。 */
interface EditorRouteState {
  fromBookId?: string;
}

/** 左侧顶部 tab 定义：作品信息 / 正文 / 草稿。 */
const editorTabs: Array<{ id: EditorTab; label: string }> = [
  { id: "info", label: "作品信息" },
  { id: "chapters", label: "正文" },
  { id: "drafts", label: "草稿" }
];

/** 切换 tab 时的默认选中项（各 tab 的占位条目 id）。 */
const defaultItemByTab: Record<EditorTab, string> = {
  info: "basic-settings",
  chapters: "chapter-plan",
  drafts: "draft-empty"
};

/** 不在作品数据中的特殊导航项：角色管理与“新增势力/地点/物品”入口（暂为页面结构）。 */
const specialEditorItems: Record<string, EditorNavItem> = {
  "manage-characters": {
    icon: UsersRound,
    id: "manage-characters",
    kind: "role-manager",
    summary: "管理主要角色和次要角色，当前只生成页面结构，不执行真实新增。",
    title: "角色"
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

/** 依据作品详情动态生成三个 tab 的完整导航树（含空态与占位条目）。 */
function createBookAwareNavigation(book: WorkspaceBookDetail): Record<EditorTab, EditorNavGroup[]> {
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
    chapters: [
      {
        id: "outline-management",
        title: "细纲管理",
        items: [
          {
            icon: Layers3,
            id: "chapter-plan",
            kind: "empty",
            meta: "暂无细纲",
            paragraphs: ["章节细纲接口尚未接入编辑器页。"],
            summary: "下一章目标、冲突和情绪节奏。",
            title: "细纲管理"
          }
        ]
      },
      {
        id: "chapters",
        title: "章节",
        items: [
          {
            fields: [
              { label: "当前章节", value: book.progress.currentChapter },
              { label: "已写总字数", value: `${formatNumber(book.progress.writtenWords)} 字` },
              { label: "已写章节", value: `${book.progress.writtenChapters}/${book.progress.plannedChapters || "AI 自动生成"}` }
            ],
            icon: BookOpenText,
            id: "current-chapter",
            kind: "chapter",
            meta: "后端进度",
            paragraphs: ["章节正文接口尚未接入编辑器页，当前不显示前端示例正文。"],
            summary: "当前章节正文与续写入口。",
            title: "当前章节"
          }
        ]
      }
    ],
    drafts: [
      {
        id: "draft-box",
        title: "草稿箱",
        items: [
          {
            icon: Archive,
            id: "draft-empty",
            kind: "draft",
            meta: "暂无内容",
            paragraphs: ["草稿箱用于保存 AI 生成但尚未采纳的版本，后续接入后端持久化。"],
            summary: "暂时没有内容。",
            title: "草稿箱"
          }
        ]
      }
    ]
  };
}

/** 继续写作页主组件：加载来源作品详情并组装编辑器三栏视图。 */
export function EditorPage() {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<EditorTab>("info");
  const [activeItemId, setActiveItemId] = useState(defaultItemByTab.info);
  const [assistantTab, setAssistantTab] = useState<AssistantTab>("chat");
  const [isAssistantCollapsed, setIsAssistantCollapsed] = useState(false);
  const [isScrollbarVisible, setIsScrollbarVisible] = useState(false);
  const [isBookLoading, setIsBookLoading] = useState(false);
  const [bookDetail, setBookDetail] = useState<WorkspaceBookDetail | null>(null);
  const [bookLoadMessage, setBookLoadMessage] = useState("");
  const scrollbarTimerRef = useRef<number | null>(null);

  const routeState = location.state as EditorRouteState | null;
  const backBookId = routeState?.fromBookId ?? "";
  const backLinkState = backBookId ? { bookId: backBookId, view: "detail" } : undefined;

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
  const navigation = createBookAwareNavigation(bookDetail);
  const currentGroups = navigation[activeTab];
  const currentItems = flattenGroups(currentGroups);
  const activeItem = currentItems.find((item) => item.id === activeItemId) ?? specialEditorItems[activeItemId] ?? currentItems[0] ?? navigation.info[0].items[0];

  return (
    <div
      className={`page novel-editor-page${isAssistantCollapsed ? " assistant-collapsed" : ""}${isScrollbarVisible ? " scrollbar-visible" : ""}`}
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
          <span>当前章节：{bookDetail.progress.currentChapter}</span>
          <span>本章计划：{bookDetail.attributes.chapterWords ? formatNumber(bookDetail.attributes.chapterWords) : "AI 自动生成"}</span>
          <span>总字数：{formatNumber(bookDetail.progress.writtenWords)}</span>
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
                        onClick={() => setActiveItemId(item.id)}
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
        </aside>

        <main className="novel-editor-center" aria-label="当前作品属性详情">
          <EditorMainPanel item={activeItem} />
        </main>

        <button
          className="novel-assistant-toggle"
          type="button"
          onClick={() => setIsAssistantCollapsed((value) => !value)}
          aria-label={isAssistantCollapsed ? "展开右侧 AI 面板" : "收起右侧 AI 面板"}
        >
          {isAssistantCollapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>

        <aside className="novel-assistant-panel" aria-label="AI 对话与灵感卡片">
          <div className="novel-assistant-tabs" role="tablist" aria-label="AI 辅助区域">
            <button
              className={assistantTab === "inspiration" ? "active" : ""}
              type="button"
              onClick={() => setAssistantTab("inspiration")}
            >
              灵感卡片
            </button>
            <button
              className={assistantTab === "chat" ? "active" : ""}
              type="button"
              onClick={() => setAssistantTab("chat")}
            >
              AI对话
            </button>
          </div>

          {assistantTab === "chat" ? <AssistantChat /> : <InspirationPanel />}
        </aside>
      </div>
    </div>
  );
}

/** 异常归一为可展示的错误文案。 */
function toMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

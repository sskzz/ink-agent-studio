import type { LucideIcon } from "lucide-react";
import { Archive, ArrowLeft, BookOpenText, Bot, Box, ChevronLeft, ChevronRight, CircleDotDashed, Eye, FileText, Flag, FolderOpen, Layers3, ListTree, MapPin, MessageCircle, Package, PencilLine, Plus, Settings2, Sparkles, Tags, UserRound, UsersRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";

type EditorTab = "info" | "chapters" | "drafts";
type AssistantTab = "chat" | "inspiration";
type EditorPanelKind = "detail" | "empty" | "chapter" | "draft";

interface EditorField {
  hint?: string;
  label: string;
  value: string;
}

interface EditorNavItem {
  chips?: string[];
  fields?: EditorField[];
  icon: LucideIcon;
  id: string;
  kind: EditorPanelKind;
  meta?: string;
  paragraphs?: string[];
  summary: string;
  title: string;
}

interface EditorNavGroup {
  id: string;
  items: EditorNavItem[];
  title: string;
}

interface EditorRouteState {
  fromBookId?: string;
}

const editorTabs: Array<{ id: EditorTab; label: string }> = [
  { id: "info", label: "作品信息" },
  { id: "chapters", label: "正文" },
  { id: "drafts", label: "草稿" }
];

/**
 * 左侧作品属性导航。
 * 这里先使用前端 mock 数据，后续接入后端时可以替换为作品目录中的 md/json 文件索引。
 */
const editorNavigation: Record<EditorTab, EditorNavGroup[]> = {
  info: [
    {
      id: "theme",
      title: "主题",
      items: [
        {
          chips: ["旧港", "来信", "轻悬疑", "单元事件", "慢热感情线"],
          icon: Tags,
          id: "tags",
          kind: "detail",
          meta: "5 个标签",
          paragraphs: ["标签用于约束后续 AI 续写方向，后端接入后可由模型自动补全和去重。"],
          summary: "作品关键词与内容方向。",
          title: "标签"
        },
        {
          fields: [
            { label: "一句话简介", value: "旧港档案管理员收到来自十年前的信，在夜班邮差的帮助下追查白银儿童失踪传闻。" },
            { label: "读者承诺", value: "温柔收束、轻悬疑、慢热信任关系。" }
          ],
          icon: FileText,
          id: "brief",
          kind: "detail",
          meta: "brief.md",
          paragraphs: ["简介会作为每次章节生成的高优先级上下文，避免故事越写越偏。"],
          summary: "作品简介、卖点和读者承诺。",
          title: "简介"
        },
        {
          fields: [
            { label: "第一卷目标", value: "确认旧港信件规则，找到白银儿童事件第一位幸存者。" },
            { label: "阶段节奏", value: "1-3 章立钩子，4-8 章查证据，9-12 章收束单元事件。" }
          ],
          icon: ListTree,
          id: "outline",
          kind: "detail",
          meta: "outline.md",
          paragraphs: ["总纲用于控制长线伏笔、章节节奏和主要转折。"],
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
            { label: "作品名称", value: "雾港来信" },
            { label: "篇幅类型", value: "短篇" },
            { label: "叙事人称", value: "第三人称" },
            { label: "频道/受众", value: "男频 · 轻悬疑" },
            { label: "主角性别", value: "女" },
            { label: "主角姓名", value: "林砚" },
            { label: "小说计划字数", value: "600,000 字", hint: "未填写时由 AI 根据题材估算。" },
            { label: "每章节计划字数", value: "3,000 字", hint: "未填写时由 AI 按节奏补全。" },
            { label: "写作风格", value: "旧港雾色 · 温柔悬疑" },
            { label: "世界观文件", value: "worldview.md", hint: "后续接入文件上传和解析。" }
          ],
          icon: Settings2,
          id: "basic-settings",
          kind: "detail",
          meta: "已保存到本地",
          paragraphs: ["这里补齐参考图中没有展开但写作系统需要长期携带的基础作品属性。"],
          summary: "篇幅、人称、主角、字数计划与风格配置。",
          title: "基础设置"
        }
      ]
    },
    {
      id: "characters",
      title: "角色",
      items: [
        {
          fields: [
            { label: "定位", value: "旧港区档案管理员，主要调查视角。" },
            { label: "当前状态", value: "已确认异常信件并开始怀疑童年记忆缺口。" }
          ],
          icon: UserRound,
          id: "linyan",
          kind: "detail",
          meta: "主要角色",
          paragraphs: ["写作时保持林砚的克制、观察力和轻微幽默感，不要把她写成战斗型角色。"],
          summary: "主角，档案管理员。",
          title: "林砚"
        },
        {
          fields: [
            { label: "定位", value: "夜班邮差，规则见证者和线索提供者。" },
            { label: "当前状态", value: "知道旧港雾气和信件的部分规则，但不能一次性说明真相。" }
          ],
          icon: UserRound,
          id: "shendu",
          kind: "detail",
          meta: "主要角色",
          paragraphs: ["沈渡可以隐瞒关键线索，但每次隐瞒都必须有保护他人或遵守规则的理由。"],
          summary: "夜班邮差，慢热关系线核心。",
          title: "沈渡"
        },
        {
          fields: [
            { label: "定位", value: "旧港诊所医生，现实证据提供者。" },
            { label: "当前状态", value: "保存部分旧案病历，认识沈渡但暂未说明关系。" }
          ],
          icon: UserRound,
          id: "doctor",
          kind: "detail",
          meta: "次要角色",
          paragraphs: ["顾医生负责把异常事件拉回现实证据层，台词要稳，不故弄玄虚。"],
          summary: "诊所医生，证据线人物。",
          title: "顾医生"
        },
        {
          icon: UsersRound,
          id: "unnamed-role",
          kind: "empty",
          meta: "待补全",
          summary: "预留次要角色位置。",
          title: "未命名"
        }
      ]
    },
    {
      id: "background",
      title: "背景",
      items: [
        {
          fields: [
            { label: "时代气质", value: "近现代城市边缘区，旧工业港与百货档案并存。" },
            { label: "叙事底色", value: "潮湿、安静、带一点温柔怪谈感。" }
          ],
          icon: FolderOpen,
          id: "background-world",
          kind: "detail",
          meta: "worldview.md",
          paragraphs: ["背景信息用于控制场景质感，避免章节忽然偏向热血战斗或宏大玄幻。"],
          summary: "故事发生的时代、城市和社会底色。",
          title: "背景"
        }
      ]
    },
    {
      id: "faction",
      title: "势力",
      items: [
        {
          icon: Flag,
          id: "oldport-faction",
          kind: "empty",
          meta: "暂无设定",
          paragraphs: ["后续可以在这里补充旧港邮政、诊所、百货档案室、白银儿童相关组织等势力关系。"],
          summary: "组织、阵营和关系网。",
          title: "势力"
        }
      ]
    },
    {
      id: "locations",
      title: "地点",
      items: [
        {
          fields: [
            { label: "旧港百货", value: "主角工作的档案空间，地下档案室是异常信件出现点。" },
            { label: "三号码头", value: "白银儿童传闻的核心地点，雾气最重。" },
            { label: "旧港诊所", value: "现实证据与旧案病历的保存点。" }
          ],
          icon: MapPin,
          id: "location-list",
          kind: "detail",
          meta: "3 个地点",
          paragraphs: ["地点会影响章节氛围和可用线索，后续可接入地图或 md 文件。"],
          summary: "关键场景和可用线索。",
          title: "地点"
        }
      ]
    },
    {
      id: "items",
      title: "物品",
      items: [
        {
          fields: [
            { label: "旧港来信", value: "来自十年前的信，字迹会随见证人数增多而褪色。" },
            { label: "百货录", value: "档案室中没有编号的旧册，第一页异常干燥。" },
            { label: "潮湿邮戳", value: "下一章需要推进的关键物证。" }
          ],
          icon: Package,
          id: "important-items",
          kind: "detail",
          meta: "3 个物品",
          paragraphs: ["物品列表用于防止关键道具丢失，也便于 AI 在续写时回收伏笔。"],
          summary: "关键道具、信件和证物。",
          title: "物品"
        }
      ]
    }
  ],
  chapters: [
    {
      id: "outline-management",
      title: "细纲管理",
      items: [
        {
          fields: [
            { label: "下一章标题", value: "04 潮湿的邮戳" },
            { label: "章节任务", value: "林砚发现旧报纸与现有信件的日期冲突。" },
            { label: "情绪目标", value: "压迫感略升，但结尾保留温柔缓冲。" }
          ],
          icon: Layers3,
          id: "chapter-plan",
          kind: "detail",
          meta: "待生成",
          paragraphs: ["细纲会作为继续写作的直接输入，后续点击“AI续写”时从这里读取。"],
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
            { label: "章节字数", value: "3,472 字" },
            { label: "已写总字数", value: "10,436 字" },
            { label: "当前状态", value: "可继续写作" }
          ],
          icon: BookOpenText,
          id: "chapter-01",
          kind: "chapter",
          meta: "3,472 字",
          paragraphs: ["林砚在旧港百货地下档案室找到没有编号的百货录，第一页夹着来自十年前的信。"],
          summary: "第一章正文与续写入口。",
          title: "第一章"
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
          paragraphs: ["草稿箱用于保存 AI 生成但尚未采纳的版本。当前第一版只预留页面，不做真实保存。"],
          summary: "暂时没有内容，快来添加吧。",
          title: "草稿箱"
        }
      ]
    }
  ]
};

const defaultItemByTab: Record<EditorTab, string> = {
  info: "oldport-faction",
  chapters: "chapter-plan",
  drafts: "draft-empty"
};

const assistantMessages = [
  {
    author: "创作助手",
    content: "已读取当前作品设定、章节规划和角色状态。你可以直接输入下一步写作目标，我会协助整理线索、生成草稿或检查设定一致性。",
    note: "内容由 AI 生成，仅供参考。"
  }
];

const inspirationCards = [
  { label: "工作流", value: "从细纲生成章节，再进入审稿与润色。" },
  { label: "其他", value: "后续可接入灵感收藏、设定片段和临时脑洞。" }
];

function flattenGroups(groups: EditorNavGroup[]) {
  return groups.flatMap((group) => group.items);
}

/**
 * 继续写作页面。
 * 当前阶段只生成前端页面：所有内容都是 mock 数据，接口接入点保留在作品属性、章节、AI 对话输入框和灵感卡片处。
 */
export function EditorPage() {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<EditorTab>("info");
  const [activeItemId, setActiveItemId] = useState(defaultItemByTab.info);
  const [assistantTab, setAssistantTab] = useState<AssistantTab>("chat");
  const [isAssistantCollapsed, setIsAssistantCollapsed] = useState(false);
  const [isScrollbarVisible, setIsScrollbarVisible] = useState(false);
  const scrollbarTimerRef = useRef<number | null>(null);

  const routeState = location.state as EditorRouteState | null;
  const backBookId = routeState?.fromBookId ?? "mist-harbor-letter";
  const currentGroups = editorNavigation[activeTab];
  const currentItems = flattenGroups(currentGroups);
  const activeItem = currentItems.find((item) => item.id === activeItemId) ?? currentItems[0] ?? editorNavigation.info[0].items[0];

  useEffect(() => {
    return () => {
      if (scrollbarTimerRef.current !== null) {
        window.clearTimeout(scrollbarTimerRef.current);
      }
    };
  }, []);

  function revealScrollbar() {
    setIsScrollbarVisible(true);

    if (scrollbarTimerRef.current !== null) {
      window.clearTimeout(scrollbarTimerRef.current);
    }

    scrollbarTimerRef.current = window.setTimeout(() => {
      setIsScrollbarVisible(false);
    }, 900);
  }

  function switchTab(tab: EditorTab) {
    setActiveTab(tab);
    setActiveItemId(defaultItemByTab[tab]);
  }

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
          state={{ bookId: backBookId, view: "detail" }}
          aria-label="退出继续写作页面并返回作品详情"
        >
          <ArrowLeft size={15} />
          <span>退出</span>
        </Link>

        <div className="novel-editor-book-meta" aria-label="作品基础状态">
          <strong>雾港来信</strong>
          <span>短篇</span>
          <span>第三人称</span>
          <span>男频</span>
          <span>已保存到本地</span>
          <span>本章字数：3472</span>
          <span>总字数：10436</span>
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
                  <Plus size={14} />
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

function EditorMainPanel({ item }: { item: EditorNavItem }) {
  return (
    <article className="novel-editor-card">
      <header className="novel-editor-card-head">
        <div>
          <h2>{item.title}</h2>
          <p>{item.summary}</p>
        </div>
      </header>

      <div className={`novel-editor-card-body ${item.kind}`}>
        {item.kind === "empty" ? (
          <div className="novel-editor-empty">
            <CircleDotDashed size={18} />
            <strong>暂无设定</strong>
            <p>{item.paragraphs?.[0] ?? "后续可以在这里补充设定，AI 也可以根据上下文自动生成初稿。"}</p>
          </div>
        ) : null}

        {item.fields ? (
          <dl className="novel-editor-field-grid">
            {item.fields.map((field) => (
              <div key={field.label}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
                {field.hint ? <small>{field.hint}</small> : null}
              </div>
            ))}
          </dl>
        ) : null}

        {item.chips ? (
          <div className="novel-editor-chip-list">
            {item.chips.map((chip) => (
              <span key={chip}>{chip}</span>
            ))}
          </div>
        ) : null}

        {item.kind === "chapter" ? (
          <textarea
            className="novel-editor-writing-area"
            defaultValue={"第一个真正潮湿的邮戳出现在林砚的办公桌上。\n\n它没有贴在信封上，而是像一枚从旧报纸里渗出来的印记，颜色深得发黑。沈渡站在门口，没有立刻解释，只把伞尖停在门槛之外。"}
          />
        ) : null}

        {item.kind === "draft" ? (
          <div className="novel-editor-empty">
            <Archive size={18} />
            <strong>暂时没有内容，快来添加吧</strong>
            <p>草稿箱将用于保存 AI 生成但尚未采纳的章节版本。</p>
          </div>
        ) : null}

        {item.paragraphs && item.kind !== "empty" && item.kind !== "draft" ? (
          <div className="novel-editor-paragraphs">
            {item.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function AssistantChat() {
  return (
    <div className="novel-assistant-chat">
      <div className="novel-assistant-tools" aria-label="AI 对话工具">
        <Bot size={15} />
        <span>默认创作工具</span>
      </div>

      <div className="novel-assistant-messages">
        {assistantMessages.map((message) => (
          <article className="novel-assistant-message" key={message.content}>
            <div className="novel-assistant-avatar">
              <Bot size={15} />
            </div>
            <div>
              <strong>{message.author}</strong>
              <p>{message.content}</p>
              <small>{message.note}</small>
            </div>
          </article>
        ))}
      </div>

      <div className="novel-assistant-input">
        <div>
          <MessageCircle size={14} />
          <span>AI对话</span>
          <small>0/50000 字</small>
        </div>
        <textarea placeholder="输入写作目标、章节动作或设定问题。按 Enter 发送，Shift + Enter 换行。" />
      </div>
    </div>
  );
}

function InspirationPanel() {
  return (
    <div className="novel-inspiration-panel">
      <div className="novel-inspiration-filter">
        <button className="active" type="button">
          <Sparkles size={14} />
          工作流
        </button>
        <button type="button">
          <Box size={14} />
          其他
        </button>
      </div>

      <div className="novel-inspiration-list">
        {inspirationCards.map((card) => (
          <article className="novel-inspiration-card" key={card.label}>
            <div>
              <PencilLine size={15} />
              <strong>{card.label}</strong>
            </div>
            <p>{card.value}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

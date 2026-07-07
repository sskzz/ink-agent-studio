import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { seedStyles } from "@/features/writing-styles/data/writingStyles";
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
  writingStyleId: string;
  protagonistGender: string;
  protagonistName: string;
  plannedWords: string;
  chapterWords: string;
  brief: string;
  worldFileName: string;
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
  writingStyleId: "",
  protagonistGender: "",
  protagonistName: "",
  plannedWords: "",
  chapterWords: "",
  brief: "",
  worldFileName: ""
};

const demoBooks: BookDetail[] = [
  {
    id: "mist-harbor-letter",
    title: "雾港来信",
    genre: "都市悬疑",
    status: "规划中",
    updatedAt: "今天 18:10",
    brief: "旧港区连续出现无法投递的匿名来信，主角在调查中发现每一封信都提前写下了收信人即将隐瞒的秘密。",
    writingStyleId: "style-cinematic-suspense",
    attributes: {
      protagonistGender: "女",
      protagonistName: "林砚",
      plannedWords: 620000,
      chapterWords: 3200,
      worldFileName: "world.md"
    },
    progress: {
      currentChapter: "第 4 章：潮湿的邮戳",
      writtenWords: 12640,
      writtenChapters: 3,
      plannedChapters: 56
    },
    characters: [
      {
        id: "lin-yan",
        name: "林砚",
        role: "主要",
        identity: "旧港区档案管理员 / 调查主视角",
        markdown: `# 林砚

**定位**：主要角色，旧港区档案管理员。

## 人物状态
- 表面冷静，习惯把所有异常都归档成可检索的线索。
- 对“父亲失踪案”保持回避，但匿名来信不断把她推回旧案现场。
- 当前章节中，她已经确认来信不是恶作剧，而是某种提前发生的记录。

## 写作提示
用动作代替心理独白。她紧张时会整理袖口、检查旧钥匙、反复确认纸张边角。`
      },
      {
        id: "shen-du",
        name: "沈渡",
        role: "主要",
        identity: "夜班邮差 / 旧港线索提供者",
        markdown: `# 沈渡

**定位**：主要角色，旧港夜班邮差。

## 人物状态
1. 对旧港地图极熟，但会刻意避开三号码头。
2. 与林砚保持合作关系，却隐瞒了第一封信的真实来源。
3. 说话短促，常用反问保护自己。

> 他不是不相信林砚，而是不相信自己还能把真相说完整。`
      },
      {
        id: "bai-yin",
        name: "白银儿童",
        role: "次要",
        identity: "传闻中的失踪儿童代称",
        markdown: `# 白银儿童

**定位**：次要角色群像，也是旧港传闻中的共同代称。

## 已知信息
- 出现在二十年前的福利院档案里。
- 名字并非真实姓名，而是一组被涂改编号后的称呼。
- 与“无法投递的来信”存在时间上的重叠。`
      },
      {
        id: "gu-yi",
        name: "顾医生",
        role: "次要",
        identity: "旧港诊所医生 / 档案见证者",
        markdown: `# 顾医生

**定位**：次要角色，旧港诊所医生。

## 关系
- 曾经给林砚父亲处理过伤口。
- 保存着一份没有归档的病历复印件。

## 禁用写法
不要把顾医生写成单纯的谜语人。他有现实顾虑：诊所、病人、旧港居民的信任。`
      }
    ],
    coreFiles: [
      {
        id: "brief",
        title: "故事基石",
        fileName: "brief.md",
        summary: "作品核心卖点、主线问题和读者承诺。",
        markdown: `# 故事基石

## 一句话钩子
每一封无法投递的信，都提前写下了收信人最想隐瞒的秘密。

## 主线问题
- 谁在写信？
- 信为什么能提前出现？
- 林砚父亲的失踪是否是第一封信造成的？

## 读者承诺
冷色电影感悬疑、旧港都市传闻、线索回收、人物克制但情绪有余温。`
      },
      {
        id: "outline",
        title: "卷纲规划",
        fileName: "outline.md",
        summary: "第一卷章节推进和悬念回收节奏。",
        markdown: `# 卷纲规划

## 第一卷：无法投递
1. 林砚收到写给失踪父亲的信。
2. 沈渡带来夜班邮路的异常记录。
3. 三号码头出现二十年前的福利院编号。
4. 顾医生交出未归档病历。

## 节奏规则
- 每 3 章回收一个小线索。
- 每 8-10 章打开一个更大的旧案层级。
- 不在段尾替读者总结恐惧，靠物件和动作收束。`
      },
      {
        id: "state",
        title: "当前状态",
        fileName: "state/current.md",
        summary: "当前章节上下文、已公开信息和未公开伏笔。",
        markdown: `# 当前状态

## 已公开信息
- 林砚收到第一封信。
- 沈渡确认邮路没有登记这封信。
- 信纸上的潮痕只出现在三号码头仓库。

## 未公开伏笔
- 顾医生知道林砚父亲最后一次出现的位置。
- “白银儿童”不是一个人，而是一批被隐藏身份的孩子。

## 下一章目标
让林砚进入三号码头仓库，但只发现一半证据。`
      },
      {
        id: "foreshadowing",
        title: "伏笔池",
        fileName: "state/foreshadowing.md",
        summary: "已投放伏笔、计划回收章节和回收方式。",
        markdown: `# 伏笔池

| 伏笔 | 投放章节 | 回收计划 |
| --- | --- | --- |
| 潮湿邮戳 | 第 1 章 | 第 4 章确认来自三号码头 |
| 银色编号 | 第 2 章 | 第 9 章连接福利院档案 |
| 沈渡避开旧桥 | 第 3 章 | 第 12 章揭示旧桥事故 |

> 伏笔不要一次解释完，只给读者足够继续翻页的确定感。`
      }
    ],
    worldview: {
      id: "world",
      title: "世界观",
      fileName: "world.md",
      summary: "旧港区地理、传闻规则和异常机制。",
      markdown: `# 世界观：旧港区

旧港区是城市里被新航线绕开的老城区。雾从傍晚开始贴着街面，邮局、诊所、码头仓库和废弃福利院构成第一卷主要空间。

## 基础规则
- 信件只会出现在“无人目击的投递点”。
- 信件内容不会直接预言死亡，而是提前写出某个秘密被揭开后的结果。
- 看到信的人越多，信上字迹越快褪色。

## 写作要求
世界观不能像设定说明书一样一次讲完。优先让规则通过事件暴露：邮戳、潮痕、褪色、误投记录。`
    }
  },
  {
    id: "star-rail-store",
    title: "星轨便利店",
    genre: "轻幻想",
    status: "草稿",
    updatedAt: "昨天 22:40",
    brief: "一间只在流星雨夜营业的便利店，接待从不同时间线短暂停靠的客人。",
    writingStyleId: "style-warm-growth",
    attributes: {
      protagonistGender: "非固定 / 群像",
      protagonistName: "夏小满",
      plannedWords: 360000,
      chapterWords: 2600,
      worldFileName: "world.md"
    },
    progress: {
      currentChapter: "第 9 章：过期的星图汽水",
      writtenWords: 21480,
      writtenChapters: 8,
      plannedChapters: 38
    },
    characters: [
      {
        id: "xia-xiaoman",
        name: "夏小满",
        role: "主要",
        identity: "便利店店员 / 群像连接点",
        markdown: `# 夏小满

**定位**：主要角色，星轨便利店店员。

## 人物状态
- 不擅长安慰别人，但记得每位客人的购物习惯。
- 她的成长线不是变得强大，而是学会承认“不舍得”。

## 细节
她会把临期商品贴上手写便签，便签经常比商品本身更受欢迎。`
      },
      {
        id: "clock-cat",
        name: "钟表猫",
        role: "次要",
        identity: "便利店收银台上的时间管理者",
        markdown: `# 钟表猫

**定位**：次要角色，负责提醒营业时间。

## 规则
- 只在整点说话。
- 说话时不会看人，只看收银台旁边那只旧钟。
- 它知道每位客人来自哪条时间线，但通常只给半句提示。`
      }
    ],
    coreFiles: [
      {
        id: "brief",
        title: "故事基石",
        fileName: "brief.md",
        summary: "轻幻想群像的核心情绪和单元结构。",
        markdown: `# 故事基石

## 核心卖点
一家只在流星雨夜营业的便利店，卖给客人的不是商品，而是一次与遗憾和解的机会。

## 单元结构
- 客人到店。
- 商品触发记忆。
- 店员参与但不过度拯救。
- 客人带走一件小东西，现实发生轻微改变。`
      },
      {
        id: "state",
        title: "当前状态",
        fileName: "state/current.md",
        summary: "当前营业夜、客人状态和未完成物品线。",
        markdown: `# 当前状态

## 当前营业夜
第 3 次流星雨夜，便利店货架出现“星图汽水”。

## 未完成物品线
- 星图汽水：连接童年约定。
- 透明雨伞：连接未来告别。
- 无声口琴：连接父女误会。`
      }
    ],
    worldview: {
      id: "world",
      title: "世界观",
      fileName: "world.md",
      summary: "星轨便利店营业规则和时间线边界。",
      markdown: `# 世界观：星轨便利店

星轨便利店位于一条不存在于地图上的街角，只在流星雨夜营业。不同时间线的人会短暂停靠，但不能长期改变彼此的人生。

## 规则
1. 客人只能买走一件商品。
2. 商品会指向一个遗憾，但不会直接替人解决遗憾。
3. 天亮前必须离店，否则会忘记这次营业夜。

## 风格要求
世界观要轻，不要重设定。用货架、价签、便签和客人的小动作传递规则。`
    }
  }
];

const writingStyleOptions = [
  {
    label: "交给 AI 自动选择",
    value: "",
    description: "根据题材、简介和目标读者自动匹配风格"
  },
  ...seedStyles.map((style) => ({
    label: style.name,
    value: style.id,
    description: style.summary
  }))
];

function getWritingStyleName(styleId: string) {
  return seedStyles.find((style) => style.id === styleId)?.name ?? "";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

/**
 * 作品库页面。
 *
 * 第一版只做前端页面状态，不真正落盘：
 * - 作品列表：展示本地作品卡片，点击进入作品详情。
 * - 作品详情：展示作品属性、写作进度、角色、核心文件和世界观。
 * - 文档弹窗：角色/核心文件/世界观使用 MarkdownRenderer 渲染 mock md 内容。
 *
 * 后续接后端时，建议在详情页加载：
 * GET /api/v1/books/:id 读取 brief.md、outline.md、state/*.json、world.md 和角色文件。
 */
export function WorkspacePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [view, setView] = useState<WorkspaceView>("list");
  const [draft, setDraft] = useState<BookDraft>(initialDraft);
  const [createdDraft, setCreatedDraft] = useState<BookDraft | null>(null);
  const [selectedBookId, setSelectedBookId] = useState(demoBooks[0]?.id ?? "");
  const [activeDocument, setActiveDocument] = useState<DetailDocument | null>(null);

  const selectedBook = demoBooks.find((book) => book.id === selectedBookId) ?? demoBooks[0];

  useEffect(() => {
    const routeState = location.state as WorkspaceRouteState | null;

    if (routeState?.view === "detail" && routeState.bookId) {
      setSelectedBookId(routeState.bookId);
      setActiveDocument(null);
      setView("detail");
      navigate("/workspace", { replace: true, state: null });
    }
  }, [location.state, navigate]);

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
    const fileName = event.target.files?.[0]?.name ?? "";
    updateDraft({ worldFileName: fileName });
  }

  function saveDraft() {
    setCreatedDraft(draft);
    setView("preview");
  }

  function continueWriting() {
    navigate("/editor", { state: { fromBookId: selectedBook?.id ?? selectedBookId } });
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

      {view === "list" ? <BookListView onOpenDetail={openDetailView} /> : null}

      {view === "detail" && selectedBook ? (
        <BookDetailView
          book={selectedBook}
          onOpenDocument={setActiveDocument}
        />
      ) : null}

      {view === "create" ? (
        <CreateBookView
          draft={draft}
          onFileChange={handleWorldFileChange}
          onSave={saveDraft}
          onUpdate={updateDraft}
        />
      ) : null}

      {view === "preview" && createdDraft ? <BookPreviewView draft={createdDraft} onCreateAnother={openCreateView} /> : null}

      {activeDocument ? <DocumentModal document={activeDocument} onClose={() => setActiveDocument(null)} /> : null}
    </div>
  );
}

interface BookListViewProps {
  onOpenDetail: (bookId: string) => void;
}

function BookListView({ onOpenDetail }: BookListViewProps) {
  return (
    <section className="workspace-layout book-list-layout">
      <div className="book-list-panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Library</p>
            <h3>作品列表</h3>
            <p className="muted">点击作品卡片进入详情。第一版数据只保存在前端 mock 中，后续会读取本地作品目录。</p>
          </div>
        </div>

        <div className="book-card-grid">
          {demoBooks.map((book) => (
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
  onOpenDocument: (document: DetailDocument) => void;
}

function BookDetailView({ book, onOpenDocument }: BookDetailViewProps) {
  const attributeRows = [
    ["作品类型", book.genre],
    ["写作风格", getWritingStyleName(book.writingStyleId) || "AI 自动选择"],
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
            <p>当前为模拟 Markdown 内容，后续会从本地作品目录读取并实时渲染。</p>
          </button>
        </section>
      </div>
    </section>
  );
}

interface CreateBookViewProps {
  draft: BookDraft;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSave: () => void;
  onUpdate: (patch: Partial<BookDraft>) => void;
}

function CreateBookView({ draft, onFileChange, onSave, onUpdate }: CreateBookViewProps) {
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
              placeholder="例如：雾港来信"
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
                <p>可选。若不上传，AI 会根据作品简介生成 `world.md`、角色初稿和世界状态 JSON。</p>
              </div>
            </label>
          </div>

          <div className="button-row">
            <button className="primary-button" type="button" onClick={onSave}>
              生成作品创建预览
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
  onCreateAnother: () => void;
}

function BookPreviewView({ draft, onCreateAnother }: BookPreviewViewProps) {
  const previewRows = [
    ["作品名称", draft.title || "AI 自动生成"],
    ["题材类型", draft.genre || "AI 自动推断"],
    ["写作风格", getWritingStyleName(draft.writingStyleId) || "AI 自动选择"],
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
          <p className="muted">这一步暂不真实创建文件，只展示未来会提交给后端的作品属性和 AI 补全范围。</p>
        </div>
        <Badge tone="amber">Mock</Badge>
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

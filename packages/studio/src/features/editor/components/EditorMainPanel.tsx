/**
 * 编辑器中央内容面板：按导航项的 kind 渲染不同形态（空态 / 字段详情 / 章节写作区 /
 * 草稿 / 角色管理 / 新建实体表单）。
 * 正文（故事基石、卷纲、当前状态、伏笔池、世界观、角色/势力/地点/物品的 Markdown 文件）
 * 统一走 MarkdownRenderer 渲染：此前直接塞进 <p> 会把 # 标题、| 表格 |、- 列表、
 * **加粗** 等语法全部当纯文本显示，格式与内容渲染全部失效。
 * kind="chapter" 的条目渲染真实章节编辑面板（ChapterEditorPanel），
 * 章节详情与续写状态由父级（EditorPage）传入，本组件只负责分发。
 */
import { CircleDotDashed, Plus } from "lucide-react";
import { MarkdownRenderer } from "@/shared/components/ui/MarkdownRenderer";
import type {
  ChapterContinueResult,
  ChapterDetail,
  ChapterUpdateInput
} from "@/features/chapter/api/chapterApi";
import { ChapterEditorPanel } from "@/features/chapter/components/ChapterEditorPanel";
import type { EditorNavItem } from "../types";

interface EditorMainPanelProps {
  item: EditorNavItem;
  /** 当前章节详情（kind="chapter" 时使用）。 */
  chapter?: ChapterDetail | null;
  chapterLoading?: boolean;
  chapterSaving?: boolean;
  chapterContinuing?: boolean;
  chapterDeleting?: boolean;
  /** 是否为最新章节：只有最新章节显示"重新生成整章"按钮。 */
  isLatestChapter?: boolean;
  continueResult?: ChapterContinueResult | null;
  /** 面板内联错误信息（续写/保存/删除失败）。 */
  chapterError?: string | null;
  /** SSE 实时正文增量（生成中展示）。 */
  streamedDraft?: string;
  /** 生成中断/失败：显示"断点续写"按钮。 */
  runInterrupted?: boolean;
  onSaveChapter?: (patch: ChapterUpdateInput) => void;
  onContinueChapter?: (instruction: string) => void;
  onResumeChapter?: () => void;
  onDeleteChapter?: () => void;
  onDismissContinueResult?: () => void;
}

/** 中央面板主组件：纯展示型，章节编辑区的交互由 ChapterEditorPanel 内部管理。 */
export function EditorMainPanel({
  item,
  chapter,
  chapterLoading,
  chapterSaving,
  chapterContinuing,
  chapterDeleting,
  isLatestChapter,
  continueResult,
  chapterError,
  streamedDraft,
  runInterrupted,
  onSaveChapter,
  onContinueChapter,
  onResumeChapter,
  onDeleteChapter,
  onDismissContinueResult
}: EditorMainPanelProps) {
  return (
    <article className="novel-editor-card">
      <header className="novel-editor-card-head"><div><h2>{item.title}</h2><p>{item.summary}</p></div></header>
      <div className={`novel-editor-card-body ${item.kind}`}>
        {item.kind === "empty" ? (
          <div className="novel-editor-empty"><CircleDotDashed size={18} /><strong>暂无设定</strong><p>{item.paragraphs?.[0] ?? "后续可以在这里补充设定，AI 也可以根据上下文自动生成初稿。"}</p></div>
        ) : null}
        {item.kind === "role-manager" ? <RoleManagerPanel /> : null}
        {item.kind === "create-entity" ? <CreateEntityPanel item={item} /> : null}
        {item.kind === "chapter" ? (
          <ChapterEditorPanel
            chapter={chapter ?? null}
            loading={Boolean(chapterLoading)}
            saving={Boolean(chapterSaving)}
            generating={Boolean(chapterContinuing)}
            runInterrupted={Boolean(runInterrupted)}
            streamedDraft={streamedDraft ?? ""}
            deleting={Boolean(chapterDeleting)}
            isLatestChapter={Boolean(isLatestChapter)}
            continueResult={continueResult ?? null}
            error={chapterError ?? null}
            onSave={(patch) => onSaveChapter?.(patch)}
            onContinue={(instruction) => onContinueChapter?.(instruction)}
            onResume={() => onResumeChapter?.()}
            onDelete={() => onDeleteChapter?.()}
            onDismissResult={() => onDismissContinueResult?.()}
          />
        ) : null}
        {item.fields ? (
          <dl className="novel-editor-field-grid">
            {item.fields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd>{field.hint ? <small>{field.hint}</small> : null}</div>)}
          </dl>
        ) : null}
        {item.chips ? <div className="novel-editor-chip-list">{item.chips.map((chip) => <span key={chip}>{chip}</span>)}</div> : null}
        {item.paragraphs && item.kind !== "empty" && item.kind !== "chapter" ? (
          <div className="novel-editor-paragraphs">
            {item.paragraphs.map((paragraph, index) => (
              <MarkdownRenderer key={`${paragraph.slice(0, 32)}-${index}`} content={paragraph} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

/** 角色管理面板：主要/次要角色分组 + 添加入口（当前为模拟结构）。 */
function RoleManagerPanel() {
  return (
    <div className="novel-role-manager">
      {(["主要角色", "次要角色"] as const).map((title) => (
        <section key={title}>
          <div className="novel-role-section-head"><h3>{title}</h3><button type="button"><Plus size={14} />添加角色</button></div>
          <div className="novel-role-card-grid"><article className="novel-role-card"><span>暂无{title}</span><p>当前不显示前端示例角色，等待角色写入接口接入。</p></article></div>
        </section>
      ))}
    </div>
  );
}

/** 新建实体（势力/地点/物品）表单：字段文案由导航项配置驱动，暂未持久化。 */
function CreateEntityPanel({ item }: { item: EditorNavItem }) {
  return (
    <form className="novel-create-entity-form" onSubmit={(event) => event.preventDefault()}>
      <label><span>{item.createNameLabel ?? "名称"}</span><input placeholder={item.createPlaceholder ?? "请输入名称"} /></label>
      <label><span>{item.createDescriptionLabel ?? "描述"}</span><textarea placeholder="输入设定说明、可用线索、限制条件或后续需要 AI 补全的方向。" /></label>
      <div className="novel-create-entity-actions"><button className="primary-button" type="button">保存为模拟设定</button><button className="ghost-button" type="reset">清空</button></div>
    </form>
  );
}

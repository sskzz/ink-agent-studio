/**
 * 章节展示面板（只读）：正文 tab 的中间卡片。
 * 职责：只读展示选中章节的标题、细纲与正文，并提供：
 * - AI 续写：指令输入 → 后端生成（Agent Run 管线）→ 结果面板 → "采纳并保存"直接写回后端；
 * - 重新生成整章：仅对"已生成过内容"且"最新章节"显示，点击后按固定指令整章重写；
 * - 删除章节：危险操作（二次确认），删除后由父级刷新列表。
 * 正文内容不可在前端直接编辑（只读）；错误信息在卡片内联展示（而非只显示在顶部栏）。
 * 数据流：父级（EditorPage）负责章节详情加载与后端调用，本组件只维护续写指令草稿，
 * 章节切换时通过 chapter.id 重置。
 */
import { LoaderCircle, RotateCcw, Send, TriangleAlert, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/shared/components/ui/ConfirmDialog";
import type {
  ChapterContinueResult,
  ChapterDetail,
  ChapterUpdateInput
} from "@/features/chapter/api/chapterApi";

/** 章节状态中文标签，用于只读展示区的状态徽章。 */
const chapterStatusLabels: Record<ChapterDetail["status"], string> = {
  planned: "待写",
  drafting: "写作中",
  reviewed: "已审",
  published: "已发布"
};

/** "重新生成整章"使用的固定续写指令：要求整章重写并保留既有设定。 */
const REGENERATE_INSTRUCTION = "重新生成整章正文：保留本章既有结构、设定与情节方向，重写全部内容，使文笔与节奏更优。";

interface ChapterEditorPanelProps {
  /** 当前选中的章节详情；null 表示尚未加载（展示加载/空态）。 */
  chapter: ChapterDetail | null;
  /** 章节详情加载中。 */
  loading: boolean;
  /** 保存提交中（采纳草稿写回后端时禁用按钮）。 */
  saving: boolean;
  /** AI 生成运行中（异步 Run + SSE 实时流）。 */
  generating: boolean;
  /** 生成中断/失败（可断点续写）。 */
  runInterrupted: boolean;
  /** 实时生成的正文增量（SSE model_delta 累积，生成中展示）。 */
  streamedDraft: string;
  /** 删除章节提交中。 */
  deleting: boolean;
  /** 是否为最新章节（只有最新章节显示"重新生成整章"按钮）。 */
  isLatestChapter: boolean;
  /** 最近一次 AI 续写结果；null 表示无结果展示。 */
  continueResult: ChapterContinueResult | null;
  /** 面板内联错误信息（生成/保存/删除失败时展示）。 */
  error: string | null;
  /** 保存回调：采纳草稿时提交新的正文内容（只读面板唯一写入路径）。 */
  onSave: (patch: ChapterUpdateInput) => void;
  /** 续写回调：提交写作指令（可空；重新生成走固定指令 + 重写建议）。 */
  onContinue: (instruction: string) => void;
  /** 断点续写回调：恢复中断的生成 Run。 */
  onResume: () => void;
  /** 删除章节回调（父级执行删除与列表刷新）。 */
  onDelete: () => void;
  /** 关闭续写结果面板。 */
  onDismissResult: () => void;
}

/** 章节只读展示面板：只读内容 + AI 实时生成（SSE）/ 断点续写 / 完全重写。 */
export function ChapterEditorPanel({
  chapter,
  loading,
  saving,
  generating,
  runInterrupted,
  streamedDraft,
  deleting,
  isLatestChapter,
  continueResult,
  error,
  onSave,
  onContinue,
  onResume,
  onDelete,
  onDismissResult
}: ChapterEditorPanelProps) {
  const [instruction, setInstruction] = useState("");
  // 重写建议：完全重写时手动输入，告知 AI 哪里不合适（随指令一并提交）
  const [rewriteSuggestion, setRewriteSuggestion] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  // 实时输出流：始终滚动到最新内容
  const streamRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    const element = streamRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [streamedDraft]);

  // 章节切换时清空续写指令与重写建议，避免串章节
  useEffect(() => {
    setInstruction("");
    setRewriteSuggestion("");
  }, [chapter?.id]);

  if (loading && !chapter) {
    return (
      <div className="chapter-editor-empty">
        <LoaderCircle size={18} />
        <strong>正在加载章节...</strong>
      </div>
    );
  }

  if (!chapter) {
    return (
      <div className="chapter-editor-empty">
        <strong>暂无章节</strong>
        <p>点击左侧章节分组右上角的"+"新建章节，或从章节列表中选择一个章节查看内容。</p>
      </div>
    );
  }

  const wordCount = chapter.content.replace(/\s/g, "").length;
  // "已生成完整内容"判定：正文非空且不是新建时的默认占位文本（"待继续写作"）；
  // 只有生成过完整内容的章节才显示"重新生成整章"按钮
  const hasGeneratedContent = chapter.content.trim().length > 0 && !chapter.content.includes("待继续写作");

  return (
    <div className="chapter-editor">
      {/* 只读头部：标题 + 状态徽章 + 卷/章/字数 + 删除章节（危险操作） */}
      <div className="chapter-editor-toolbar">
        <h3 className="chapter-editor-title">{chapter.title || "（未命名章节）"}</h3>
        <span className="chapter-editor-status" data-status={chapter.status}>
          {chapterStatusLabels[chapter.status]}
        </span>
        <span className="chapter-editor-meta">
          第 {chapter.volumeNo} 卷 · 第 {chapter.chapterNo} 章 · {wordCount} 字
        </span>
        <button
          className="chapter-editor-delete"
          type="button"
          disabled={deleting || generating}
          onClick={() => setConfirmDeleteOpen(true)}
        >
          <Trash2 size={13} />
          {deleting ? "删除中..." : "删除章节"}
        </button>
      </div>

      {/* 删除章节确认：项目样式弹窗（替代浏览器原生 confirm） */}
      <ConfirmDialog
        open={confirmDeleteOpen}
        title="删除章节"
        message={`确定删除章节「${chapter.title || "未命名章节"}」吗？正文文件与章节记录将一并删除，此操作无法恢复。`}
        confirmLabel="删除章节"
        cancelLabel="取消"
        danger
        onConfirm={() => {
          setConfirmDeleteOpen(false);
          onDelete();
        }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />

      {/* 只读细纲 */}
      <section className="chapter-editor-section">
        <h4>本章细纲</h4>
        {chapter.outline.trim() ? (
          <p className="chapter-editor-readonly-text">{chapter.outline}</p>
        ) : (
          <p className="chapter-editor-readonly-empty">暂无细纲。</p>
        )}
      </section>

      {/* 只读正文 */}
      <section className="chapter-editor-section">
        <h4>章节正文</h4>
        {chapter.content.trim() ? (
          <div className="chapter-editor-readonly-content"><pre>{chapter.content}</pre></div>
        ) : (
          <p className="chapter-editor-readonly-empty">本章尚无正文，可使用下方 AI 续写生成初稿。</p>
        )}
      </section>

      {/* 面板内联错误：续写/保存/删除失败时在此醒目展示（模型未配置、密钥缺失等） */}
      {error ? (
        <div className="chapter-editor-error">
          <TriangleAlert size={14} />
          <span>{error}</span>
        </div>
      ) : null}

      {/* AI 生成区：续写 + 完全重写（含重写建议）+ 断点续写 + 实时正文流 */}
      <div className="chapter-editor-continue">
        <div>
          <Send size={14} />
          <span>AI 生成（结果不会自动写入正文，需在结果面板点击"采纳并保存"）</span>
        </div>
        <textarea
          value={instruction}
          placeholder="续写指令（可留空，默认自然续写）。例如：推进陈栀拒绝恶意剧本的转折，注意节奏。"
          onChange={(event) => setInstruction(event.target.value)}
        />
        <div className="chapter-editor-generate-actions">
          <button
            className="primary-button"
            type="button"
            data-loading={generating ? "true" : undefined}
            disabled={generating || saving || deleting}
            onClick={() => onContinue(instruction)}
          >
            {generating ? "正在生成..." : "生成续写草稿"}
          </button>
          {hasGeneratedContent && isLatestChapter ? (
            <button
              className="ghost-button"
              type="button"
              disabled={generating || saving || deleting}
              onClick={() => onContinue(
                rewriteSuggestion.trim()
                  ? `${REGENERATE_INSTRUCTION}\n重写建议：${rewriteSuggestion.trim()}`
                  : REGENERATE_INSTRUCTION
              )}
            >
              <RotateCcw size={13} />
              重新生成整章
            </button>
          ) : null}
          {runInterrupted ? (
            <button className="ghost-button" type="button" disabled={saving} onClick={onResume}>
              断点续写
            </button>
          ) : null}
        </div>
        {hasGeneratedContent && isLatestChapter ? (
          <label className="chapter-editor-rewrite-suggestion">
            <span>重写建议（可选，告知 AI 哪里不合适）</span>
            <textarea
              value={rewriteSuggestion}
              placeholder="例如：节奏太拖沓、陈栀的反应不符合人设、冲突不够尖锐..."
              onChange={(event) => setRewriteSuggestion(event.target.value)}
            />
          </label>
        ) : null}
        {generating ? (
          <div className="chapter-editor-stream">
            <div className="chapter-editor-stream-head">
              <strong>正在生成（实时输出）</strong>
              <span>生成过程中可随时中断，之后可点击"断点续写"从断点继续</span>
            </div>
            <pre ref={streamRef}>{streamedDraft || "（等待模型输出...）"}</pre>
          </div>
        ) : null}
      </div>

      {continueResult ? (
        <div className="chapter-continue-result">
          <div className="chapter-continue-result-head">
            <strong>续写结果（待确认草稿，未写入正文）</strong>
            <div>
              {continueResult.revisionCount ? <span>自动修订 {continueResult.revisionCount} 次</span> : null}
              {continueResult.degraded ? (
                <span className="chapter-continue-warn">
                  <TriangleAlert size={12} />
                  存在降级
                </span>
              ) : null}
              <button className="ghost-button" type="button" onClick={onDismissResult}>收起</button>
            </div>
          </div>
          {continueResult.degradationReasons.length > 0 ? (
            <ul className="chapter-continue-reasons">
              {continueResult.degradationReasons.map((reason, index) => (
                <li key={`${reason.code}-${index}`}>{reason.message}</li>
              ))}
            </ul>
          ) : null}
          <div className="chapter-continue-draft">
            <pre>{continueResult.draft}</pre>
          </div>
          <div className="chapter-continue-actions">
            {/* 只读面板的唯一写入路径：采纳 = 用草稿覆盖正文并保存到后端；
                章节尚未自定义标题（默认"新章节"）时顺带采纳 AI 生成的标题 */}
            <button
              className="primary-button"
              type="button"
              data-loading={saving ? "true" : undefined}
              disabled={saving || generating || deleting}
              onClick={() => onSave({
                content: continueResult.draft,
                status: "drafting",
                // 生成完成后后端通常已经回填细纲；这里再带上同一份有效细纲，
                // 即使回填发生在旧数据或瞬时写入失败，也不会在采纳正文时丢失。
                outline: !chapter.outline.trim() && continueResult.chapterOutline?.trim()
                  ? continueResult.chapterOutline
                  : undefined,
                title: continueResult.chapterTitle && (chapter.title === "新章节" || !chapter.title.trim())
                  ? continueResult.chapterTitle
                  : undefined
              })}
            >
              {saving ? "保存中..." : "采纳并保存"}
            </button>
            <button className="ghost-button" type="button" onClick={onDismissResult}>
              放弃结果
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

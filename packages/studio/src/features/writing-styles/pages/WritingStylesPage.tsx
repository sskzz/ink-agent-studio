import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { Badge } from "@/shared/components/ui/Badge";
import { PageHeader } from "@/shared/components/ui/PageHeader";
import { AnalysisResultPanel } from "@/features/writing-styles/components/AnalysisResultPanel";
import { StyleDetailView } from "@/features/writing-styles/components/StyleDetailView";
import type { AnalysisResult, WritingStyle } from "@/features/writing-styles/data/writingStyles";
import {
  activateWritingStyleVersion,
  addWritingStyleSample,
  analyzeWritingStyle,
  createWritingStyle,
  deleteWritingStyleSample,
  listWritingStyleSamples,
  listWritingStyleVersions,
  listWritingStyles,
  rebuildWritingStyle
} from "@/features/writing-styles/api/writingStylesApi";
import type { WritingStyleSampleDto, WritingStyleVersionDto } from "@/features/writing-styles/api/writingStylesApi";

type StyleView = "list" | "create" | "detail";

/**
 * 写作风格页。
 *
 * 当前版本已接入后端本地风格库：
 * - 风格列表读取 /api/v1/writing-styles，后端为空时展示空状态。
 * - 新增风格支持读取首个模板文件内容并请求 /api/v1/writing-styles/analyze 生成分析预览。
 * - 用户确认后点击“保存风格”才会调用 /api/v1/writing-styles 持久化。
 * - 风格详情展示分析摘要、来源文件和提示词片段。
 */
export function WritingStylesPage() {
  const [view, setView] = useState<StyleView>("list");
  const [styles, setStyles] = useState<WritingStyle[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [styleName, setStyleName] = useState("");
  const [styleNote, setStyleNote] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [sampleContent, setSampleContent] = useState("");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<"analyze" | "save" | null>(null);
  const [styleSamples, setStyleSamples] = useState<WritingStyleSampleDto[]>([]);
  const [styleVersions, setStyleVersions] = useState<WritingStyleVersionDto[]>([]);
  const [managingStyle, setManagingStyle] = useState(false);

  const selectedStyle = styles.find((style) => style.id === selectedId) ?? styles[0];
  const fileCount = styles.reduce((total, style) => total + style.sourceFiles.length, 0);
  const analyzedCount = styles.filter((style) => style.analysis.parameters.length > 0).length;

  useEffect(() => {
    let ignore = false;

    async function loadStyles() {
      setLoading(true);

      try {
        const nextStyles = await listWritingStyles();

        if (!ignore) {
          setStyles(nextStyles);
          setSelectedId(nextStyles[0]?.id ?? "");
          setFeedback("");
        }
      } catch (error) {
        if (!ignore) {
          setFeedback(`写作风格后端读取失败：${toMessage(error)}`);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void loadStyles();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (view !== "detail" || !selectedStyle) return;
    let ignore = false;
    setManagingStyle(true);
    void Promise.all([listWritingStyleSamples(selectedStyle.id), listWritingStyleVersions(selectedStyle.id)])
      .then(([samples, versions]) => {
        if (!ignore) {
          setStyleSamples(samples);
          setStyleVersions(versions);
        }
      })
      .catch((error) => {
        if (!ignore) setFeedback(`读取多样本风格资产失败：${toMessage(error)}`);
      })
      .finally(() => {
        if (!ignore) setManagingStyle(false);
      });
    return () => { ignore = true; };
  }, [view, selectedStyle?.id]);

  function openCreateView() {
    setStyleName("");
    setStyleNote("");
    setSelectedFiles([]);
    setSampleContent("");
    setAnalysisResult(null);
    setFeedback("");
    setView("create");
  }

  function openDetailView(style: WritingStyle) {
    setSelectedId(style.id);
    setFeedback("");
    setView("detail");
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const names = files.map((file) => file.name);
    setSelectedFiles(names);
    setSampleContent("");
    setAnalysisResult(null);
    setFeedback(names.length > 0 ? `已收集 ${names.length} 个本地模板作品，等待 AI 分析。` : "");

    // 第一版只读取首个模板文件内容，先满足后端分析接口需要的文本输入。
    if (files[0]) {
      void files[0]
        .text()
        .then((content) => {
          setSampleContent(content);
        })
        .catch(() => {
          setFeedback("模板文件读取失败，可改用风格名称和说明作为分析输入。");
        });
    }
  }

  async function analyzeStyle() {
    const content = sampleContent || styleNote || styleName;

    if (!content.trim()) {
      setFeedback("请先选择模板文件，或填写风格名称和说明后再执行 AI 分析。");
      return;
    }

    setSaving(true);
    setPendingAction("analyze");

    try {
      const style = await analyzeWritingStyle({
        name: styleName.trim() || "AI 分析风格",
        sampleFileName: selectedFiles[0] ?? "manual-description.md",
        content
      });
      setAnalysisResult(style.analysis);
      const generatedMeta = getGeneratedStyleMeta(style.analysis);
      setStyleName(generatedMeta.name);
      setStyleNote(generatedMeta.description);
      setFeedback("AI 分析已完成，已自动生成并填入风格名称和风格说明。请确认后点击“保存风格”。");
    } catch (error) {
      setAnalysisResult(null);
      setFeedback(`AI 分析失败：${toMessage(error)}`);
    } finally {
      setSaving(false);
      setPendingAction(null);
    }
  }

  async function saveStyle() {
    const trimmedName = styleName.trim();
    if (!analysisResult) {
      setFeedback("请先完成真实 AI 分析，再保存写作风格。");
      return;
    }
    const result = analysisResult;

    setSaving(true);
    setPendingAction("save");

    try {
      const savedStyle = await createWritingStyle({
        name: trimmedName || "未命名写作风格",
        summary:
          styleNote.trim() ||
          result.summary ||
          "由模板作品分析生成的写作风格，可作为写作 Agent 的风格约束和审稿规则来源。",
        parameters:
          result.rawParameters ?? Object.fromEntries(result.parameters.map((parameter) => [parameter.label, parameter.value])),
        sampleFileName: selectedFiles[0] ?? null,
        analysis: result
      });
      if (sampleContent.trim() && selectedFiles[0]) {
        await addWritingStyleSample(savedStyle.id, { fileName: selectedFiles[0], content: sampleContent });
      }
      const nextStyles = await listWritingStyles();
      setStyles(nextStyles);
      setSelectedId(savedStyle.id);
      setFeedback("风格已保存到后端本地风格库。");
      setView("detail");
    } catch (error) {
      setFeedback(`风格保存失败：${toMessage(error)}`);
    } finally {
      setSaving(false);
      setPendingAction(null);
    }
  }

  function copyPromptSnippet(snippet: string) {
    // 浏览器不允许时也不阻塞页面，真实版本可接入统一 Toast 组件提示复制结果。
    void navigator.clipboard?.writeText(snippet);
    setFeedback("提示词片段已复制到剪贴板。");
  }

  async function addSampleFile(file: File) {
    if (!selectedStyle) return;
    setManagingStyle(true);
    try {
      await addWritingStyleSample(selectedStyle.id, { fileName: file.name, content: await file.text() });
      const [samples, nextStyles] = await Promise.all([
        listWritingStyleSamples(selectedStyle.id),
        listWritingStyles()
      ]);
      setStyleSamples(samples);
      setStyles(nextStyles);
      setFeedback("样本已加入风格资产；重建后会生成新的不可变版本。");
    } catch (error) {
      setFeedback(`添加样本失败：${toMessage(error)}`);
    } finally {
      setManagingStyle(false);
    }
  }

  async function removeSample(sampleId: string) {
    if (!selectedStyle) return;
    setManagingStyle(true);
    try {
      await deleteWritingStyleSample(selectedStyle.id, sampleId);
      const [samples, nextStyles] = await Promise.all([
        listWritingStyleSamples(selectedStyle.id),
        listWritingStyles()
      ]);
      setStyleSamples(samples);
      setStyles(nextStyles);
      setFeedback("样本已从下一版本的聚合集合中移除。");
    } catch (error) {
      setFeedback(`删除样本失败：${toMessage(error)}`);
    } finally {
      setManagingStyle(false);
    }
  }

  async function rebuildSelectedStyle() {
    if (!selectedStyle) return;
    setManagingStyle(true);
    try {
      await rebuildWritingStyle(selectedStyle.id);
      const [nextStyles, versions] = await Promise.all([listWritingStyles(), listWritingStyleVersions(selectedStyle.id)]);
      setStyles(nextStyles);
      setStyleVersions(versions);
      setFeedback("多样本聚合完成，新的不可变风格版本已生成。");
    } catch (error) {
      setFeedback(`重建风格失败：${toMessage(error)}`);
    } finally {
      setManagingStyle(false);
    }
  }

  async function activateVersion(versionId: string) {
    if (!selectedStyle) return;
    setManagingStyle(true);
    try {
      await activateWritingStyleVersion(selectedStyle.id, versionId);
      setStyles(await listWritingStyles());
      setFeedback("已激活选定风格版本；已有作品仍保持其固定版本。");
    } catch (error) {
      setFeedback(`激活版本失败：${toMessage(error)}`);
    } finally {
      setManagingStyle(false);
    }
  }

  return (
    <div className="page style-page">
      <PageHeader
        eyebrow="Writing Style"
        title="写作风格"
        description="沉淀你自己的文风模板：用本地文本样本执行 AI 分析，生成风格摘要、节奏规则和去 AI 味约束。"
        actions={
          view === "list" ? (
            <button className="primary-button" type="button" onClick={openCreateView}>
              新增风格
            </button>
          ) : (
            <button className="ghost-button" type="button" onClick={() => setView("list")}>
              返回风格列表
            </button>
          )
        }
      />

      <section className="dashboard-strip" aria-label="写作风格摘要">
        <article>
          <span>风格数量</span>
          <strong>{styles.length}</strong>
        </article>
        <article>
          <span>模板文件</span>
          <strong>{fileCount}</strong>
        </article>
        <article>
          <span>已分析</span>
          <strong>{analyzedCount}</strong>
        </article>
      </section>

      {loading ? <div className="test-banner">正在读取后端写作风格库...</div> : null}
      {saving ? <div className="test-banner">正在同步后端风格数据...</div> : null}
      {feedback ? <div className="test-banner success">{feedback}</div> : null}

      {/* key 跟随子页面变化，保证列表、新增、详情之间切换时有明确的进入动画。 */}
      <div className="style-view-transition" key={view}>
        {view === "list" ? (
          <StyleListView styles={styles} selectedId={selectedId} onOpenDetail={openDetailView} />
        ) : null}

        {view === "create" ? (
          <StyleCreateView
            analysisResult={analysisResult}
            analyzing={pendingAction === "analyze"}
            selectedFiles={selectedFiles}
            saving={pendingAction === "save"}
            styleName={styleName}
            styleNote={styleNote}
            onAnalyze={analyzeStyle}
            onFileChange={handleFileChange}
            onSave={saveStyle}
            onStyleNameChange={setStyleName}
            onStyleNoteChange={setStyleNote}
          />
        ) : null}

        {view === "detail" && selectedStyle ? (
          <StyleDetailView
            style={selectedStyle}
            samples={styleSamples}
            versions={styleVersions}
            managing={managingStyle}
            onAddSample={addSampleFile}
            onRemoveSample={removeSample}
            onRebuild={rebuildSelectedStyle}
            onActivateVersion={activateVersion}
            onCopyPrompt={copyPromptSnippet}
          />
        ) : null}
      </div>
    </div>
  );
}

function getGeneratedStyleMeta(analysis: AnalysisResult) {
  const rawAnalysis = analysis.rawAnalysis;

  if (typeof rawAnalysis === "object" && rawAnalysis !== null && "dominantStyle" in rawAnalysis) {
    const dominantStyle = rawAnalysis.dominantStyle;

    if (typeof dominantStyle === "object" && dominantStyle !== null) {
      const name = "name" in dominantStyle && typeof dominantStyle.name === "string" ? dominantStyle.name.trim() : "";
      const description =
        "description" in dominantStyle && typeof dominantStyle.description === "string"
          ? dominantStyle.description.trim()
          : "";

      if (name) {
        return { name, description: description || analysis.summary };
      }
    }
  }

  const primaryFeature = analysis.parameters.find((parameter) => parameter.value.trim())?.value.trim();
  return {
    name: primaryFeature || "AI 分析风格",
    description: analysis.summary
  };
}

interface StyleListViewProps {
  styles: WritingStyle[];
  selectedId: string;
  onOpenDetail: (style: WritingStyle) => void;
}

function StyleListView({ styles, selectedId, onOpenDetail }: StyleListViewProps) {
  return (
    <section className="style-list-view">
      <div className="section-title">
        <div>
          <p className="eyebrow">Style Library</p>
          <h3>风格列表</h3>
          <p className="muted">点击任意风格查看详情。这里完全使用后端本地风格库数据。</p>
        </div>
      </div>

      <div className="style-grid">
        {styles.length === 0 ? (
          <div className="empty-list">后端风格库暂无数据。点击右上角“新增风格”创建第一条写作风格。</div>
        ) : null}
        {styles.map((style) => (
          <button
            className={`style-card${style.id === selectedId ? " active" : ""}`}
            key={style.id}
            type="button"
            onClick={() => onOpenDetail(style)}
          >
            <div className="style-card-head">
              <div>
                <strong>{style.name}</strong>
                <p>{style.summary}</p>
              </div>
            </div>

            <div className="style-chip-row">
              {style.tags.map((tag) => (
                <Badge key={tag} tone="blue">
                  {tag}
                </Badge>
              ))}
            </div>

            <div className="style-metric-grid" aria-label={`${style.name} 风格参数摘要`}>
              <span>
                <em>语气</em>
                {style.metrics.tone}
              </span>
              <span>
                <em>节奏</em>
                {style.metrics.rhythm}
              </span>
              <span>
                <em>视角</em>
                {style.metrics.pointOfView}
              </span>
              <span>
                <em>去 AI 味</em>
                {style.metrics.aiReduction}
              </span>
            </div>

            <div className="style-card-foot">
              <span>{style.sourceFiles.length} 个模板文件</span>
              <span>最近分析 {style.lastAnalyzed}</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

interface StyleCreateViewProps {
  analysisResult: AnalysisResult | null;
  analyzing: boolean;
  selectedFiles: string[];
  saving: boolean;
  styleName: string;
  styleNote: string;
  onAnalyze: () => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSave: () => void;
  onStyleNameChange: (value: string) => void;
  onStyleNoteChange: (value: string) => void;
}

function StyleCreateView({
  analysisResult,
  analyzing,
  selectedFiles,
  saving,
  styleName,
  styleNote,
  onAnalyze,
  onFileChange,
  onSave,
  onStyleNameChange,
  onStyleNoteChange
}: StyleCreateViewProps) {
  const canAnalyze =
    selectedFiles.length > 0 ||
    styleName.trim().length > 0 ||
    styleNote.trim().length > 0;

  return (
    <section className="style-create-layout">
      <div className="style-form-panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">New Style</p>
            <h3>新增风格页面</h3>
            <p className="muted">通过本地文本模板收集样本，再交给 AI 分析生成风格结果。</p>
          </div>
        </div>

        <form className="model-form" onSubmit={(event) => event.preventDefault()}>
          <label className="field full">
            <span>风格名称</span>
            <input
              value={styleName}
              placeholder="例如：冷色电影感悬疑 / 温暖成长群像"
              onChange={(event) => onStyleNameChange(event.target.value)}
            />
          </label>

          <label className="field full">
            <span>风格说明</span>
            <textarea
              value={styleNote}
              placeholder="简单描述你希望模型学习什么：节奏、对白、描写方式、禁用表达等。"
              onChange={(event) => onStyleNoteChange(event.target.value)}
            />
          </label>

          <div className="field full">
            <span>模板作品采集</span>
            <div className="source-intake">
              <label className="source-upload-card">
                <input
                  accept=".txt,.md"
                  className="native-file-input"
                  type="file"
                  onChange={onFileChange}
                />
                <span className="source-upload-icon">TXT</span>
                <strong>选择本地模板作品</strong>
                <p>导入 TXT 或 Markdown 文本，内容会提交给后端分析并可保存为风格样本。</p>
              </label>
            </div>
          </div>

          <div className="selected-source-strip">
            {selectedFiles.length === 0 ? (
              <span className="empty-list">尚未添加模板来源。请选择本地 TXT 或 Markdown 文件。</span>
            ) : null}
            {selectedFiles.map((fileName) => (
              <span key={fileName}>{fileName}</span>
            ))}
          </div>

          <div className="button-row">
            <button
              className="ghost-button"
              type="button"
              data-loading={analyzing ? "true" : undefined}
              disabled={!canAnalyze || analyzing || saving}
              onClick={onAnalyze}
            >
              {analyzing ? "AI分析中..." : "AI分析"}
            </button>
            <button
              className="primary-button"
              type="button"
              data-loading={saving ? "true" : undefined}
              disabled={analyzing || saving}
              onClick={onSave}
            >
              {saving ? "保存中..." : "保存风格"}
            </button>
          </div>
        </form>
      </div>

      <AnalysisResultPanel result={analysisResult} />
    </section>
  );
}

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

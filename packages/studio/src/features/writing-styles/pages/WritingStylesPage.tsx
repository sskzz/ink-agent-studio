import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { Badge } from "@/shared/components/ui/Badge";
import { PageHeader } from "@/shared/components/ui/PageHeader";
import { simulatedAnalysis } from "@/features/writing-styles/data/writingStyles";
import type { AnalysisResult, StyleParameter, WritingStyle } from "@/features/writing-styles/data/writingStyles";
import {
  analyzeWritingStyle,
  createWritingStyle,
  listWritingStyles
} from "@/features/writing-styles/api/writingStylesApi";

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
  const [searchKeywords, setSearchKeywords] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [sampleContent, setSampleContent] = useState("");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

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

  function openCreateView() {
    setStyleName("");
    setStyleNote("");
    setSearchKeywords("");
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
          setFeedback("模板文件读取失败，可改用网络搜索关键词或风格备注后再分析。");
        });
    }
  }

  async function analyzeStyle() {
    const content = sampleContent || searchKeywords || styleNote || styleName;

    if (!content.trim()) {
      setFeedback("请先选择模板文件，或填写网络搜索关键词/风格备注后再执行 AI 分析。");
      return;
    }

    setSaving(true);

    try {
      const style = await analyzeWritingStyle({
        name: styleName.trim() || "AI 分析风格",
        sampleFileName: selectedFiles[0] ?? "search-keywords.md",
        content
      });
      setAnalysisResult(style.analysis);
      setFeedback("AI 分析已完成。请确认结果后点击“保存风格”，届时才会写入后端风格库。");
    } catch (error) {
      setAnalysisResult(simulatedAnalysis);
      setFeedback(`AI 分析接口调用失败，已展示前端模拟结果：${toMessage(error)}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveStyle() {
    const trimmedName = styleName.trim();
    const result = analysisResult ?? {
      ...simulatedAnalysis,
      summary: "该风格已保存为草稿，后续可补充模板作品并重新执行 AI 分析。",
      parameters: []
    };

    setSaving(true);

    try {
      const savedStyle = await createWritingStyle({
        name: trimmedName || "未命名写作风格",
        summary:
          styleNote.trim() ||
          result.summary ||
          "由模板作品分析生成的写作风格，可作为写作 Agent 的风格约束和审稿规则来源。",
        parameters: Object.fromEntries(result.parameters.map((parameter) => [parameter.label, parameter.value])),
        sampleFileName: selectedFiles[0] ?? null
      });
      const nextStyles = await listWritingStyles();
      setStyles(nextStyles);
      setSelectedId(savedStyle.id);
      setFeedback("风格已保存到后端本地风格库。");
      setView("detail");
    } catch (error) {
      setFeedback(`风格保存失败：${toMessage(error)}`);
    } finally {
      setSaving(false);
    }
  }

  function copyPromptSnippet(snippet: string) {
    // 浏览器不允许时也不阻塞页面，真实版本可接入统一 Toast 组件提示复制结果。
    void navigator.clipboard?.writeText(snippet);
    setFeedback("提示词片段已复制到剪贴板。");
  }

  return (
    <div className="page style-page">
      <PageHeader
        eyebrow="Writing Style"
        title="写作风格"
        description="沉淀你自己的文风模板：用本地文件和网络搜索线索收集样章，执行 AI 分析后生成风格摘要、节奏规则和去 AI 味约束。"
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
            searchKeywords={searchKeywords}
            selectedFiles={selectedFiles}
            styleName={styleName}
            styleNote={styleNote}
            onAnalyze={analyzeStyle}
            onFileChange={handleFileChange}
            onSave={saveStyle}
            onSearchKeywordsChange={setSearchKeywords}
            onStyleNameChange={setStyleName}
            onStyleNoteChange={setStyleNote}
          />
        ) : null}

        {view === "detail" && selectedStyle ? (
          <StyleDetailView style={selectedStyle} onCopyPrompt={copyPromptSnippet} />
        ) : null}
      </div>
    </div>
  );
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
              <span>{style.searchKeywords}</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

interface StyleCreateViewProps {
  analysisResult: AnalysisResult | null;
  searchKeywords: string;
  selectedFiles: string[];
  styleName: string;
  styleNote: string;
  onAnalyze: () => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSave: () => void;
  onSearchKeywordsChange: (value: string) => void;
  onStyleNameChange: (value: string) => void;
  onStyleNoteChange: (value: string) => void;
}

function StyleCreateView({
  analysisResult,
  searchKeywords,
  selectedFiles,
  styleName,
  styleNote,
  onAnalyze,
  onFileChange,
  onSave,
  onSearchKeywordsChange,
  onStyleNameChange,
  onStyleNoteChange
}: StyleCreateViewProps) {
  const canAnalyze =
    selectedFiles.length > 0 ||
    searchKeywords.trim().length > 0 ||
    styleName.trim().length > 0 ||
    styleNote.trim().length > 0;

  return (
    <section className="style-create-layout">
      <div className="style-form-panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">New Style</p>
            <h3>新增风格页面</h3>
            <p className="muted">通过本地模板作品和网络搜索线索收集样本，再交给 AI 分析生成风格结果。</p>
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
                  accept=".txt,.md,.doc,.docx,.pdf"
                  className="native-file-input"
                  multiple
                  type="file"
                  onChange={onFileChange}
                />
                <span className="source-upload-icon">DOC</span>
                <strong>选择本地模板作品</strong>
                <p>点击导入 txt、md、doc、docx、pdf。当前会读取首个文本类文件内容用于后端分析预览。</p>
              </label>

              <label className="source-search-card">
                <span className="source-upload-icon">WEB</span>
                <strong>网络搜索线索</strong>
                <p>预留给后续网络搜索/链接采集能力，当前仅做页面输入。</p>
                <input
                  value={searchKeywords}
                  placeholder="输入作品关键词、作者名或参考链接"
                  onChange={(event) => onSearchKeywordsChange(event.target.value)}
                />
              </label>
            </div>
          </div>

          <div className="selected-source-strip">
            {selectedFiles.length === 0 && searchKeywords.trim().length === 0 ? (
              <span className="empty-list">尚未添加模板来源。请选择本地文件，或填写网络搜索线索。</span>
            ) : null}
            {selectedFiles.map((fileName) => (
              <span key={fileName}>{fileName}</span>
            ))}
            {searchKeywords.trim() ? <span>搜索：{searchKeywords.trim()}</span> : null}
          </div>

          <div className="button-row">
            <button className="ghost-button" type="button" disabled={!canAnalyze} onClick={onAnalyze}>
              AI分析
            </button>
            <button className="primary-button" type="button" onClick={onSave}>
              保存风格
            </button>
          </div>
        </form>
      </div>

      <AnalysisResultPanel result={analysisResult} />
    </section>
  );
}

interface AnalysisResultPanelProps {
  result: AnalysisResult | null;
}

function AnalysisResultPanel({ result }: AnalysisResultPanelProps) {
  return (
    <aside className="style-analysis-panel analysis-result-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">AI Result</p>
          <h3>AI 分析结果</h3>
          <p className="muted">点击“AI分析”后，这里展示后端分析预览；点击“保存风格”后才写入本地风格库。</p>
        </div>
        <Badge tone={result ? "sage" : "amber"}>{result ? "已分析" : "等待分析"}</Badge>
      </div>

      {result ? (
        <div className="analysis-result-content">
          <div className="analysis-summary">
            <span>分析摘要</span>
            <p>{result.summary}</p>
          </div>

          <div className="analysis-result-list">
            <ResultRow label="声音画像" value={result.voiceProfile} />
            <ResultRow label="结构规则" value={result.structureRule} />
            <ResultRow label="去 AI 味" value={result.aiReductionRule} />
          </div>

          <div className="prompt-preview">
            <span>可复用提示词</span>
            <p>{result.promptSnippet}</p>
          </div>
        </div>
      ) : (
        <div className="analysis-empty-state">
          <span className="analysis-orb" />
          <strong>等待 AI 分析</strong>
          <p>添加模板来源后点击“AI分析”。这里不会再提前展示参数卡片，只展示分析完成后的结果。</p>
        </div>
      )}
    </aside>
  );
}

interface ResultRowProps {
  label: string;
  value: string;
}

function ResultRow({ label, value }: ResultRowProps) {
  return (
    <article className="analysis-result-item">
      <span>{label}</span>
      <p>{value}</p>
    </article>
  );
}

interface StyleDetailViewProps {
  style: WritingStyle;
  onCopyPrompt: (snippet: string) => void;
}

function StyleDetailView({ style, onCopyPrompt }: StyleDetailViewProps) {
  return (
    <section className="style-detail-layout">
      <article className="style-detail-hero">
        <div className="style-card-head">
          <div>
            <p className="eyebrow">Style Detail</p>
            <h3>{style.name}</h3>
            <p className="muted">{style.summary}</p>
          </div>
          <Badge tone="blue">{style.lastAnalyzed}</Badge>
        </div>

        <div className="style-chip-row">
          {style.tags.map((tag) => (
            <Badge key={tag} tone="blue">
              {tag}
            </Badge>
          ))}
        </div>

        <div className="style-metric-grid">
          <span>
            <em>语气</em>
            {style.metrics.tone}
          </span>
          <span>
            <em>节奏</em>
            {style.metrics.rhythm}
          </span>
          <span>
            <em>叙事视角</em>
            {style.metrics.pointOfView}
          </span>
          <span>
            <em>去 AI 味</em>
            {style.metrics.aiReduction}
          </span>
        </div>

        <div className="prompt-preview">
          <span>参考提示词片段</span>
          <p>{style.analysis.promptSnippet}</p>
        </div>

        <div className="button-row">
          <button className="ghost-button" type="button" onClick={() => onCopyPrompt(style.analysis.promptSnippet)}>
            复制提示词片段
          </button>
          <button className="ghost-button" type="button" disabled>
            编辑参数（预留）
          </button>
        </div>
      </article>

      <aside className="style-side-panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Source Files</p>
            <h3>模板来源</h3>
          </div>
        </div>
        <div className="source-file-list">
          {style.sourceFiles.map((fileName) => (
            <span key={fileName}>{fileName}</span>
          ))}
          <span>搜索：{style.searchKeywords}</span>
        </div>
        <p className="muted">最近分析：{style.lastAnalyzed}</p>
      </aside>

      <div className="style-analysis-panel full">
        <div className="section-title">
          <div>
            <p className="eyebrow">Analysis</p>
            <h3>风格分析结果</h3>
            <p className="muted">这些结果后续会传给写作模型、审稿模型和去 AI 味规则链路。</p>
          </div>
        </div>

        <div className="analysis-result-content">
          <div className="analysis-summary">
            <span>分析摘要</span>
            <p>{style.analysis.summary}</p>
          </div>
          <div className="analysis-result-list">
            <ResultRow label="声音画像" value={style.analysis.voiceProfile} />
            <ResultRow label="结构规则" value={style.analysis.structureRule} />
            <ResultRow label="去 AI 味" value={style.analysis.aiReductionRule} />
          </div>
          <div className="style-insight-grid">
            {style.analysis.parameters.length > 0 ? (
              style.analysis.parameters.map((parameter) => <InsightMeter key={parameter.label} parameter={parameter} />)
            ) : (
              <div className="empty-list">该风格还没有生成参数，请在新增页面添加模板来源并执行 AI 分析。</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

interface InsightMeterProps {
  parameter: StyleParameter;
}

function InsightMeter({ parameter }: InsightMeterProps) {
  return (
    <article className="style-insight-item">
      <div>
        <span>{parameter.label}</span>
        <strong>{parameter.value}</strong>
        <p>{parameter.description}</p>
      </div>
      <div className="parameter-meter" aria-label={`${parameter.label} 置信度 ${parameter.score}%`}>
        <span style={{ width: `${parameter.score}%` }} />
      </div>
    </article>
  );
}

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

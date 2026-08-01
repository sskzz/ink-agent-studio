import { Badge } from "@/shared/components/ui/Badge";
import type { WritingStyleSampleDto, WritingStyleVersionDto } from "../api/writingStylesApi";
import type { StyleParameter, WritingStyle } from "../data/writingStyles";
import { ResultRow } from "./AnalysisResultPanel";

interface StyleDetailViewProps {
  style: WritingStyle;
  samples: WritingStyleSampleDto[];
  versions: WritingStyleVersionDto[];
  managing: boolean;
  onAddSample: (file: File) => void;
  onRemoveSample: (sampleId: string) => void;
  onRebuild: () => void;
  onActivateVersion: (versionId: string) => void;
  onCopyPrompt: (snippet: string) => void;
}

export function StyleDetailView({
  style,
  samples,
  versions,
  managing,
  onAddSample,
  onRemoveSample,
  onRebuild,
  onActivateVersion,
  onCopyPrompt
}: StyleDetailViewProps) {
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
          {style.tags.map((tag) => <Badge key={tag} tone="blue">{tag}</Badge>)}
          <Badge tone={style.status === "ready" ? "blue" : "amber"}>{style.status ?? "draft"}</Badge>
          <Badge tone="sage">有效样本 {style.validSampleCount ?? samples.filter((sample) => sample.quality.usable).length}</Badge>
        </div>

        <div className="style-metric-grid">
          <span><em>语气</em>{style.metrics.tone}</span>
          <span><em>节奏</em>{style.metrics.rhythm}</span>
          <span><em>叙事视角</em>{style.metrics.pointOfView}</span>
          <span><em>去 AI 味</em>{style.metrics.aiReduction}</span>
        </div>

        <div className="prompt-preview"><span>参考提示词片段</span><p>{style.analysis.promptSnippet}</p></div>
        {style.analysis.reviewPromptSnippet ? (
          <div className="prompt-preview"><span>审稿提示词片段</span><p>{style.analysis.reviewPromptSnippet}</p></div>
        ) : null}

        <div className="button-row">
          <button className="ghost-button" type="button" onClick={() => onCopyPrompt(style.analysis.promptSnippet)}>复制提示词片段</button>
        </div>
      </article>

      <aside className="style-side-panel">
        <div className="section-title"><div><p className="eyebrow">Source Files</p><h3>模板来源</h3></div></div>
        <div className="source-file-list">{style.sourceFiles.map((fileName) => <span key={fileName}>{fileName}</span>)}</div>
        <p className="muted">最近分析：{style.lastAnalyzed}</p>
      </aside>

      <div className="style-analysis-panel full">
        <div className="section-title">
          <div><p className="eyebrow">Multi-sample Profile</p><h3>多样本与版本</h3><p className="muted">至少三篇有效正文样本后，稳定指标才会升级为强约束。</p></div>
          <div className="button-row">
            <label className="ghost-button">
              添加样本
              <input
                accept=".txt,.md"
                hidden
                type="file"
                disabled={managing}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onAddSample(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <button className="primary-button" type="button" disabled={managing || samples.length === 0} onClick={onRebuild}>
              {managing ? "处理中..." : "重建风格版本"}
            </button>
          </div>
        </div>

        <div className="analysis-result-list">
          {samples.length ? samples.map((sample) => (
            <article className="analysis-result-item" key={sample.id}>
              <span>{sample.quality.usable ? "有效样本" : "弱样本"}</span>
              <p>{sample.fileName} · {sample.contentLength} 字 · 权重 {sample.quality.weight}</p>
              {sample.quality.warnings.length ? <small>{sample.quality.warnings.join("；")}</small> : null}
              <button className="ghost-button" type="button" disabled={managing} onClick={() => onRemoveSample(sample.id)}>移除</button>
            </article>
          )) : <div className="empty-list">尚未保存多样本。添加正文样本后再重建版本。</div>}
        </div>

        <div className="analysis-result-list">
          {versions.length ? versions.map((version) => (
            <article className="analysis-result-item" key={version.id}>
              <span>{version.status} · 置信度 {version.confidence}</span>
              <p>{version.id} · {version.sampleCount} 个样本 · {version.styleHash.slice(0, 12)}</p>
              <button
                className="ghost-button"
                type="button"
                disabled={managing || style.latestVersionId === version.id}
                onClick={() => onActivateVersion(version.id)}
              >
                {style.latestVersionId === version.id ? "当前版本" : "设为最新"}
              </button>
            </article>
          )) : <div className="empty-list">尚无不可变版本。</div>}
        </div>
      </div>

      <div className="style-analysis-panel full">
        <div className="section-title"><div><p className="eyebrow">Analysis</p><h3>风格分析结果</h3><p className="muted">这些结果会传给写作模型、审稿模型和去 AI 味规则链路。</p></div></div>
        <div className="analysis-result-content">
          <div className="analysis-summary"><span>分析摘要</span><p>{style.analysis.summary}</p></div>
          <div className="analysis-result-list">
            <ResultRow label="声音画像" value={style.analysis.voiceProfile} />
            <ResultRow label="结构规则" value={style.analysis.structureRule} />
            <ResultRow label="去 AI 味" value={style.analysis.aiReductionRule} />
          </div>
          {style.analysis.antiAiRules?.length ? (
            <div className="analysis-result-list">
              {style.analysis.antiAiRules.slice(0, 6).map((rule) => (
                <ResultRow key={`${rule.type}-${rule.category}-${rule.rule}`} label={`去 AI 味 · ${rule.severity}`} value={`${rule.rule} 识别：${rule.detectHint} 修正：${rule.rewriteHint}`} />
              ))}
            </div>
          ) : null}
          <div className="style-insight-grid">
            {style.analysis.parameters.length > 0
              ? style.analysis.parameters.map((parameter) => <InsightMeter key={parameter.label} parameter={parameter} />)
              : <div className="empty-list">该风格还没有生成参数，请在新增页面添加模板来源并执行 AI 分析。</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

function InsightMeter({ parameter }: { parameter: StyleParameter }) {
  return (
    <article className="style-insight-item">
      <div><span>{parameter.label}</span><strong>{parameter.value}</strong><p>{parameter.description}</p></div>
      <div className="parameter-meter" aria-label={`${parameter.label} 置信度 ${parameter.score}%`}><span style={{ width: `${parameter.score}%` }} /></div>
    </article>
  );
}

/**
 * 风格详情视图：风格总览、初始来源、多样本/版本管理与完整分析结果。
 * 样本与版本数据由父页传入，添加/移除/重建/激活等操作回调父级执行。
 */
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Badge } from "@/shared/components/ui/Badge";
import { ConfirmDialog } from "@/shared/components/ui/ConfirmDialog";
import type { WritingStyleSampleDto, WritingStyleVersionDto } from "../api/writingStylesApi";
import type { StyleParameter, WritingStyle } from "../data/writingStyles";
import { ResultRow } from "./AnalysisResultPanel";

interface StyleDetailViewProps {
  style: WritingStyle;
  samples: WritingStyleSampleDto[];
  versions: WritingStyleVersionDto[];
  managing: boolean;
  deleting: boolean;
  onAddSample: (file: File) => void;
  onRemoveSample: (sampleId: string) => void;
  onRebuild: () => void;
  onReanalyzeSamples: () => void;
  onActivateVersion: (versionId: string) => void;
  onCopyPrompt: (snippet: string) => void;
  onDeleteStyle: () => void;
}

/** 风格详情视图主组件：纯展示 + 操作回调，不持有数据状态。 */
export function StyleDetailView({
  style,
  samples,
  versions,
  managing,
  deleting,
  onAddSample,
  onRemoveSample,
  onRebuild,
  onReanalyzeSamples,
  onActivateVersion,
  onCopyPrompt,
  onDeleteStyle
}: StyleDetailViewProps) {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  return (
    <section className="style-detail-layout">
      <ConfirmDialog
        open={confirmDeleteOpen}
        title="删除写作风格"
        message={`确定永久删除“${style.name}”吗？该风格的全部样本、历史版本和编译缓存都会删除，此操作无法恢复。`}
        confirmLabel="删除风格"
        cancelLabel="取消"
        danger
        onConfirm={() => {
          setConfirmDeleteOpen(false);
          onDeleteStyle();
        }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
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
          <Badge tone="sage">有效样本 {style.validSampleCount ?? samples.filter((sample) => resolveSampleStatus(sample) === "accepted").length}</Badge>
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
          <button className="danger-button" type="button" disabled={managing || deleting} onClick={() => setConfirmDeleteOpen(true)}>
            <Trash2 size={14} />
            {deleting ? "删除中..." : "删除风格"}
          </button>
        </div>
      </article>

      <aside className="style-side-panel">
        <div className="section-title"><div><p className="eyebrow">Source Sample</p><h3>初始来源</h3></div></div>
        <div className="source-file-list">
          {samples.filter((sample) => sample.role === "seed" || sample.id === style.seedSampleId).map((sample) => (
            <span key={sample.id}>{sample.fileName} · 已作为初始样本进入样本库</span>
          ))}
          {!samples.some((sample) => sample.role === "seed" || sample.id === style.seedSampleId) && style.legacySourceFileName ? (
            <span>{style.legacySourceFileName} · 历史来源正文缺失，不计入样本</span>
          ) : null}
          {!style.legacySourceFileName && !samples.some((sample) => sample.role === "seed" || sample.id === style.seedSampleId) ? <span>尚未设置初始来源</span> : null}
        </div>
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
            <button className="ghost-button" type="button" disabled={managing || samples.length === 0} onClick={onReanalyzeSamples}>
              重新质检全部
            </button>
          </div>
        </div>

        <div className="analysis-result-list">
          {samples.length ? samples.map((sample) => (
            <article className="analysis-result-item" key={sample.id}>
              <span>{sampleStatusLabel(sample)}</span>
              <p>{sample.fileName} · {sample.role === "seed" ? "初始样本 · " : ""}{sample.contentLength} 字 · 权重 {sample.quality.weight}</p>
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
        <div className="section-title"><div><p className="eyebrow">Initial Analysis</p><h3>初始样本分析</h3><p className="muted">这里保留创建风格时的单样本分析；当前多样本状态以样本库和版本列表为准。</p></div></div>
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
              : <div className="empty-list">该风格还没有生成参数，请在新增页面添加初始样本并执行 AI 分析。</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

function resolveSampleStatus(sample: WritingStyleSampleDto) {
  return sample.quality.status
    ?? (!sample.quality.usable ? "rejected" : sample.quality.weight < 0.5 ? "weak" : "accepted");
}

function sampleStatusLabel(sample: WritingStyleSampleDto) {
  const status = resolveSampleStatus(sample);
  return status === "accepted" ? "有效样本" : status === "weak" ? "弱证据" : "已排除";
}

/** 参数指标条：标签 + 展示值 + 说明，底部的 meter 宽度表示置信度。 */
function InsightMeter({ parameter }: { parameter: StyleParameter }) {
  return (
    <article className="style-insight-item">
      <div><span>{parameter.label}</span><strong>{parameter.value}</strong><p>{parameter.description}</p></div>
      <div className="parameter-meter" aria-label={`${parameter.label} 置信度 ${parameter.score}%`}><span style={{ width: `${parameter.score}%` }} /></div>
    </article>
  );
}

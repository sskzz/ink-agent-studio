/**
 * AI 分析结果面板：新增风格流程中的实时分析预览（保存前不落库）。
 * result 为空时展示等待态；ResultRow 同时被详情视图复用。
 */
import { Badge } from "@/shared/components/ui/Badge";
import type { AnalysisResult } from "../data/writingStyles";

interface AnalysisResultPanelProps {
  result: AnalysisResult | null;
}

/** 分析预览面板：有结果时展示摘要/规则/提示词，无结果时给引导文案。 */
export function AnalysisResultPanel({ result }: AnalysisResultPanelProps) {
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
            {result.reviewPromptSnippet ? <ResultRow label="审稿片段" value={result.reviewPromptSnippet} /> : null}
          </div>

          <div className="prompt-preview">
            <span>可复用提示词</span>
            <p>{result.promptSnippet}</p>
          </div>

          {result.antiAiRules?.length ? (
            <div className="analysis-result-list">
              {result.antiAiRules.slice(0, 4).map((rule) => (
                <ResultRow
                  key={`${rule.type}-${rule.category}-${rule.rule}`}
                  label={`去 AI 味 · ${rule.severity}`}
                  value={`${rule.rule} 识别：${rule.detectHint} 修正：${rule.rewriteHint}`}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="analysis-empty-state">
          <span className="analysis-orb" />
          <strong>等待 AI 分析</strong>
          <p>添加模板来源后点击“AI分析”。这里不会提前展示参数卡片，只展示分析完成后的真实结果。</p>
        </div>
      )}
    </aside>
  );
}

/** 单条分析结果行：标签 + 值，供摘要类内容复用。 */
export function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <article className="analysis-result-item">
      <span>{label}</span>
      <p>{value}</p>
    </article>
  );
}

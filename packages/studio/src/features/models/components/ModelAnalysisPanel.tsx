import { providerOptions } from "@/config/modelOptions";
import { Badge } from "@/shared/components/ui/Badge";
import type { ModelAnalysis } from "@/shared/types/domain";

const analysisStatusLabel: Record<ModelAnalysis["status"], string> = {
  ready: "可运行",
  partial: "需优化",
  blocked: "未就绪"
};

const analysisStatusTone: Record<ModelAnalysis["status"], "sage" | "amber" | "rose"> = {
  ready: "sage",
  partial: "amber",
  blocked: "rose"
};

const issueTone: Record<ModelAnalysis["issues"][number]["severity"], "sage" | "amber" | "rose" | "blue"> = {
  info: "blue",
  warning: "amber",
  critical: "rose"
};

function providerLabel(provider: string) {
  return providerOptions.find((option) => option.value === provider)?.label ?? provider;
}

export function ModelAnalysisPanel({ analysis, loading }: { analysis: ModelAnalysis | null; loading: boolean }) {
  const visibleIssues = analysis?.issues.slice(0, 4) ?? [];
  const visibleSuggestions = analysis?.suggestions.slice(0, 4) ?? [];

  return (
    <section className={`model-analysis-panel status-${analysis?.status ?? "loading"}`}>
      <div className="model-analysis-hero">
        <div>
          <p className="eyebrow">AI Model Analysis</p>
          <h3>模型体系分析</h3>
          <p>
            {analysis
              ? "基于后端模型配置、用途路由和参数风险生成的本地诊断，不读取密钥，也不会真实调用模型。"
              : loading ? "正在从后端读取模型分析结果..." : "等待后端返回模型分析结果。"}
          </p>
        </div>

        <div className="model-analysis-score" aria-label="模型体系健康分">
          <strong>{analysis?.score ?? 0}</strong><span>/100</span>
          <Badge tone={analysis ? analysisStatusTone[analysis.status] : "blue"}>
            {analysis ? analysisStatusLabel[analysis.status] : "分析中"}
          </Badge>
        </div>
      </div>

      <div className="model-analysis-metrics">
        <article><span>配置总数</span><strong>{analysis?.summary.totalConfigs ?? 0}</strong></article>
        <article><span>启用配置</span><strong>{analysis?.summary.enabledConfigs ?? 0}</strong></article>
        <article><span>支持测试</span><strong>{analysis?.summary.supportedAdapterConfigs ?? 0}</strong></article>
        <article><span>路由就绪</span><strong>{analysis?.summary.routeReadyCount ?? 0}/3</strong></article>
      </div>

      {analysis ? (
        <>
          <div className="model-route-health-grid">
            {analysis.routes.map((route) => (
              <article className={route.ready ? "ready" : "blocked"} key={route.routeKey}>
                <div><strong>{route.label}</strong><p>{route.modelName}</p></div>
                <Badge tone={route.ready ? "sage" : "amber"}>{route.ready ? "已就绪" : "需配置"}</Badge>
                <small>{route.provider === "none" ? "未选择模型" : providerLabel(route.provider)}</small>
              </article>
            ))}
          </div>

          <div className="model-analysis-columns">
            <div>
              <h4>风险提示</h4>
              {visibleIssues.length === 0 ? <p className="muted">暂未发现配置风险。</p> : visibleIssues.map((issue) => (
                <article className="analysis-issue-item" key={issue.id}>
                  <Badge tone={issueTone[issue.severity]}>{issue.title}</Badge><p>{issue.description}</p>
                </article>
              ))}
            </div>
            <div>
              <h4>优化建议</h4>
              {visibleSuggestions.length === 0 ? <p className="muted">暂无额外建议。</p> : visibleSuggestions.map((suggestion) => (
                <article className="analysis-suggestion-item" key={suggestion}><span /><p>{suggestion}</p></article>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

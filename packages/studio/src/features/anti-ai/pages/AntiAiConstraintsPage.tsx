/**
 * 去 AI 味约束页：展示全局规则集状态、按分类筛选规则表与协作说明。
 * 数据来自后端规则集（只读），页面不做任何写操作。
 */
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Fingerprint, ShieldCheck } from "lucide-react";
import {
  getAntiAiConstraints,
  type AntiAiCategory,
  type AntiAiConstraintOverview
} from "@/features/anti-ai/api/antiAiConstraintsApi";
import { PageHeader } from "@/shared/components/ui/PageHeader";

type CategoryFilter = "all" | AntiAiCategory;

/** 分类筛选 → 中文标签（"all" 表示全部）。 */
const categoryLabels: Record<CategoryFilter, string> = {
  all: "全部",
  structure: "结构",
  language: "语言",
  emotion: "情绪",
  dialogue: "对白",
  description: "描写",
  logic: "逻辑",
  rhythm: "节奏"
};

/** 约束适用阶段 → 中文标签。 */
const stageLabels = { generation: "写作", review: "审稿", polish: "润色" } as const;

/** 去 AI 味约束页主组件：加载规则集并用分类筛选规则。 */
export function AntiAiConstraintsPage() {
  const [overview, setOverview] = useState<AntiAiConstraintOverview | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 挂载时拉取规则集一次；ignore 标记防止卸载后 setState。
  useEffect(() => {
    let ignore = false;
    setLoading(true);
    getAntiAiConstraints()
      .then((value) => {
        if (!ignore) setOverview(value);
      })
      .catch((reason: unknown) => {
        if (!ignore) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  // 规则按当前分类筛选；"all" 时展示全部规则。
  const visibleRules = useMemo(
    () => overview?.rules.filter((rule) => selectedCategory === "all" || rule.category === selectedCategory) ?? [],
    [overview, selectedCategory]
  );

  return (
    <div className="page anti-ai-page">
      <PageHeader
        eyebrow="Global Writing Policy"
        title="去 AI 味约束"
        description="全局正文表达基线，统一作用于小说写作、审稿与润色。"
      />

      {loading ? <div className="anti-ai-state">正在读取全局规则集...</div> : null}
      {error ? <div className="anti-ai-state error">规则读取失败：{error}</div> : null}

      {overview ? (
        <>
          <section className="anti-ai-status-band" aria-label="规则集状态">
            <div className="anti-ai-status-primary">
              <span className="anti-ai-status-icon"><ShieldCheck size={20} /></span>
              <div>
                <span>全局规则集</span>
                <strong>{overview.enabled ? "已启用" : "不可用"}</strong>
              </div>
            </div>
            <dl className="anti-ai-status-metrics">
              <div><dt>版本</dt><dd>{overview.version}</dd></div>
              <div><dt>规则</dt><dd>{overview.ruleCount} 条</dd></div>
              <div><dt>Guard</dt><dd>{overview.guardCount} 条</dd></div>
              <div><dt>覆盖阶段</dt><dd>{overview.stages.map((stage) => stageLabels[stage]).join(" / ")}</dd></div>
            </dl>
            <div className="anti-ai-hash" title={overview.constraintHash}>
              <Fingerprint size={16} />
              <span>{overview.constraintHash.slice(0, 16)}</span>
            </div>
          </section>

          <section className="anti-ai-rules-section">
            <div className="anti-ai-section-heading">
              <div>
                <p className="eyebrow">Rule Registry</p>
                <h3>约束规则</h3>
              </div>
              <span>{visibleRules.length} 条当前结果</span>
            </div>

            <div className="anti-ai-category-filter" role="tablist" aria-label="规则分类">
              {(Object.keys(categoryLabels) as CategoryFilter[]).map((category) => (
                <button
                  aria-selected={selectedCategory === category}
                  className={selectedCategory === category ? "active" : ""}
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  role="tab"
                  type="button"
                >
                  {categoryLabels[category]}
                </button>
              ))}
            </div>

            {visibleRules.length ? (
              <div className="anti-ai-table-wrap">
                <table className="anti-ai-rule-table">
                  <thead>
                    <tr>
                      <th>规则</th>
                      <th>正文约束</th>
                      <th>检测与修改</th>
                      <th>阶段</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRules.map((rule) => (
                      <tr key={rule.id}>
                        <td>
                          <strong>{rule.title}</strong>
                          <div className="anti-ai-rule-meta">
                            <span className={`severity-${rule.severity}`}>{severityLabel(rule.severity)}</span>
                            <span>{rule.level === "guard" ? "不可放宽" : "风格可调整"}</span>
                          </div>
                          <code>{rule.canonicalKey}</code>
                        </td>
                        <td>{rule.promptClause}</td>
                        <td>
                          <span className="anti-ai-detail-label">检测</span>
                          <p>{rule.detectHint}</p>
                          <span className="anti-ai-detail-label">修改</span>
                          <p>{rule.rewriteHint}</p>
                        </td>
                        <td>
                          <div className="anti-ai-stage-list">
                            {rule.appliesTo.map((stage) => <span key={stage}>{stageLabels[stage]}</span>)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="anti-ai-state">当前分类没有规则。</div>}
          </section>

          <section className="anti-ai-cooperation" aria-labelledby="anti-ai-cooperation-title">
            <div className="anti-ai-section-heading">
              <div>
                <p className="eyebrow">Style Coordination</p>
                <h3 id="anti-ai-cooperation-title">与写作风格协作</h3>
              </div>
              <span>canonicalKey 去重</span>
            </div>
            <div className="anti-ai-cooperation-grid">
              <article><CheckCircle2 size={17} /><div><strong>全局基线</strong><p>所有小说正文始终应用，Guard 规则不可被风格关闭。</p></div></article>
              <article><CheckCircle2 size={17} /><div><strong>风格调整</strong><p>样本规则只收紧、放宽可调整项，或补充独有表达风险。</p></div></article>
              <article><CheckCircle2 size={17} /><div><strong>单次注入</strong><p>同一语义键合并为一条有效规则，审稿与修订共用结果。</p></div></article>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

/** 严重级别 → 中文标签：高 / 中 / 低。 */
function severityLabel(severity: "low" | "medium" | "high") {
  return severity === "high" ? "高" : severity === "medium" ? "中" : "低";
}


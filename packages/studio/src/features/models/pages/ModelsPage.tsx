import { useEffect, useState } from "react";
import { providerOptions, purposeLabel, purposeOptions } from "@/config/modelOptions";
import { Badge } from "@/shared/components/ui/Badge";
import { PageHeader } from "@/shared/components/ui/PageHeader";
import { SelectField } from "@/shared/components/ui/SelectField";
import { useModelConfigStore } from "@/shared/stores/modelConfigStore";
import type { ModelConfig, ModelProvider, ModelPurpose } from "@/shared/types/domain";

type ModelView = "types" | "list" | "detail" | "writing" | "review";

/**
 * 模型配置页。
 *
 * 页面结构按“模型类型入口 -> 模型列表/用途分配 -> 模型详情”组织：
 * - 模型列表：管理所有可调用模型。
 * - 写作模型：从模型列表中选择 Agent 写正文时使用的模型。
 * - 审稿模型：从模型列表中选择审稿/修订时使用的模型。
 *
 * 第一版仍然只做前端页面和 mock 交互；真实后端接入点在 src/api/modelConfigApi.ts。
 */
export function ModelsPage() {
  const [view, setView] = useState<ModelView>("types");

  const {
    configs,
    draft,
    usage,
    loading,
    saving,
    testing,
    error,
    testResult,
    selectedId,
    loadConfigs,
    createConfig,
    selectConfig,
    updateDraft,
    saveDraft,
    removeConfig,
    markDefault,
    assignPurposeModel,
    testDraft
  } = useModelConfigStore();

  useEffect(() => {
    void loadConfigs();
  }, [loadConfigs]);

  const enabledCount = configs.filter((config) => config.enabled).length;
  const defaultConfig = configs.find((config) => config.isDefault);
  const writingConfig = configs.find((config) => config.id === usage.writingModelId);
  const reviewConfig = configs.find((config) => config.id === usage.reviewModelId);

  function openCreateForm() {
    createConfig();
    setView("detail");
  }

  function openDetail(config: ModelConfig) {
    selectConfig(config);
    setView("detail");
  }

  function backToTypes() {
    setView("types");
  }

  return (
    <div className="page model-page">
      <PageHeader
        eyebrow="Providers"
        title="模型配置"
        description="先按模型类型进入：模型列表负责维护配置，写作模型和审稿模型负责从列表中选择实际使用的模型。"
        actions={
          view !== "types" ? (
            <button className="ghost-button" type="button" onClick={backToTypes}>
              返回模型类型
            </button>
          ) : null
        }
      />

      <section className="dashboard-strip" aria-label="模型配置摘要">
        <article>
          <span>配置数量</span>
          <strong>{configs.length}</strong>
        </article>
        <article>
          <span>已启用</span>
          <strong>{enabledCount}</strong>
        </article>
        <article>
          <span>默认模型</span>
          <strong>{defaultConfig?.name ?? "未设置"}</strong>
        </article>
      </section>

      {error ? <div className="test-banner failed">{error}</div> : null}

      {/* key 跟随模型子视图变化，点击模型类型/列表/详情时会触发轻量切换动效。 */}
      <div className="model-view-transition" key={view}>
        {view === "types" ? (
          <ModelTypeLanding
            configsCount={configs.length}
            loading={loading}
            reviewConfig={reviewConfig}
            writingConfig={writingConfig}
            onOpenList={() => setView("list")}
            onOpenReview={() => setView("review")}
            onOpenWriting={() => setView("writing")}
          />
        ) : null}

        {view === "list" ? (
          <ModelListView
            configs={configs}
            loading={loading}
            selectedId={selectedId}
            onCreate={openCreateForm}
            onOpenDetail={openDetail}
          />
        ) : null}

        {view === "writing" ? (
          <PurposeModelView
            configs={configs}
            currentId={usage.writingModelId}
            saving={saving}
            title="写作模型"
            description="选择 Agent 生成正文、续写章节、扩写片段时默认调用的模型。"
            actionLabel="设为写作模型"
            onAssign={(modelId) => void assignPurposeModel("writing", modelId)}
            onOpenDetail={openDetail}
          />
        ) : null}

        {view === "review" ? (
          <PurposeModelView
            configs={configs}
            currentId={usage.reviewModelId}
            saving={saving}
            title="审稿模型"
            description="选择 Agent 做连续性检查、AI 味检测、章节修订时默认调用的模型。"
            actionLabel="设为审稿模型"
            onAssign={(modelId) => void assignPurposeModel("review", modelId)}
            onOpenDetail={openDetail}
          />
        ) : null}

        {view === "detail" ? (
          <ModelDetailView
            draft={draft}
            saving={saving}
            testing={testing}
            testResult={testResult}
            onChange={updateDraft}
            onDelete={() => draft.id && void removeConfig(draft.id)}
            onMarkDefault={() => draft.id && void markDefault(draft.id)}
            onSave={() => void saveDraft()}
            onTest={() => void testDraft()}
          />
        ) : null}
      </div>
    </div>
  );
}

interface ModelTypeLandingProps {
  configsCount: number;
  loading: boolean;
  writingConfig?: ModelConfig;
  reviewConfig?: ModelConfig;
  onOpenList: () => void;
  onOpenWriting: () => void;
  onOpenReview: () => void;
}

function ModelTypeLanding({
  configsCount,
  loading,
  writingConfig,
  reviewConfig,
  onOpenList,
  onOpenWriting,
  onOpenReview
}: ModelTypeLandingProps) {
  return (
    <section className="model-type-grid" aria-label="模型类型">
      <button className="model-type-card" type="button" onClick={onOpenList}>
        <Badge tone="blue">{loading ? "加载中" : `${configsCount} 个配置`}</Badge>
        <h3>模型列表</h3>
        <p>查看、新增和维护所有模型配置。点击具体模型后进入详情表单。</p>
      </button>

      <button className="model-type-card" type="button" onClick={onOpenWriting}>
        <Badge tone="sage">写作链路</Badge>
        <h3>写作模型</h3>
        <p>当前：{writingConfig?.name ?? "未设置"}。用于正文生成、章节续写和片段扩写。</p>
      </button>

      <button className="model-type-card" type="button" onClick={onOpenReview}>
        <Badge tone="amber">审稿链路</Badge>
        <h3>审稿模型</h3>
        <p>当前：{reviewConfig?.name ?? "未设置"}。用于审稿、修订、连续性检查和去 AI 味。</p>
      </button>
    </section>
  );
}

interface ModelListViewProps {
  configs: ModelConfig[];
  loading: boolean;
  selectedId: string | null;
  onCreate: () => void;
  onOpenDetail: (config: ModelConfig) => void;
}

function ModelListView({ configs, loading, selectedId, onCreate, onOpenDetail }: ModelListViewProps) {
  return (
    <section className="model-list-view">
      <div className="section-title">
        <div>
          <p className="eyebrow">Model List</p>
          <h3>模型列表</h3>
          <p className="muted">这里展示所有已配置模型。点击模型卡片进入详情，点击“新增模型”创建新配置。</p>
        </div>
        <button className="primary-button" type="button" onClick={onCreate}>
          新增模型
        </button>
      </div>

      {loading ? <div className="test-banner success">正在读取模型配置...</div> : null}

      <div className="model-catalog-grid">
        {configs.length === 0 ? (
          <div className="empty-list">暂无模型配置，点击右上角“新增模型”开始。</div>
        ) : (
          configs.map((config) => (
            <ModelSummaryCard
              config={config}
              key={config.id}
              selected={selectedId === config.id}
              onOpen={() => onOpenDetail(config)}
            />
          ))
        )}
      </div>
    </section>
  );
}

interface PurposeModelViewProps {
  configs: ModelConfig[];
  currentId: string | null;
  saving: boolean;
  title: string;
  description: string;
  actionLabel: string;
  onAssign: (modelId: string) => void;
  onOpenDetail: (config: ModelConfig) => void;
}

function PurposeModelView({
  configs,
  currentId,
  saving,
  title,
  description,
  actionLabel,
  onAssign,
  onOpenDetail
}: PurposeModelViewProps) {
  return (
    <section className="model-list-view">
      <div className="section-title">
        <div>
          <p className="eyebrow">Routing</p>
          <h3>{title}</h3>
          <p className="muted">{description}</p>
        </div>
      </div>

      <div className="model-catalog-grid">
        {configs.map((config) => {
          const isCurrent = currentId === config.id;
          return (
            <article className={`purpose-card${isCurrent ? " active" : ""}`} key={config.id}>
              <div className="purpose-card-main">
                <span className={`status-dot${config.enabled ? " online" : ""}`} />
                <div>
                  <h4>{config.name}</h4>
                  <p>{config.model}</p>
                </div>
              </div>
              <div className="purpose-card-meta">
                <Badge tone={isCurrent ? "amber" : "blue"}>
                  {isCurrent ? "当前使用" : purposeLabel[config.purpose]}
                </Badge>
                {config.isDefault ? <Badge tone="sage">默认</Badge> : null}
              </div>
              <p className="muted">{config.note || "暂无备注。"}</p>
              <div className="button-row">
                <button
                  className="primary-button"
                  type="button"
                  disabled={saving || isCurrent}
                  onClick={() => onAssign(config.id)}
                >
                  {isCurrent ? "已选择" : actionLabel}
                </button>
                <button className="ghost-button" type="button" onClick={() => onOpenDetail(config)}>
                  查看详情
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

interface ModelSummaryCardProps {
  config: ModelConfig;
  selected: boolean;
  onOpen: () => void;
}

function ModelSummaryCard({ config, selected, onOpen }: ModelSummaryCardProps) {
  return (
    <button className={`model-summary-card${selected ? " active" : ""}`} type="button" onClick={onOpen}>
      <div className="model-summary-head">
        <span className={`status-dot${config.enabled ? " online" : ""}`} />
        <strong>{config.name}</strong>
      </div>
      <p>{config.model}</p>
      <div className="model-summary-tags">
        <Badge tone="blue">{providerOptions.find((option) => option.value === config.provider)?.label}</Badge>
        <Badge tone={config.isDefault ? "amber" : "sage"}>
          {config.isDefault ? "默认模型" : purposeLabel[config.purpose]}
        </Badge>
      </div>
    </button>
  );
}

interface ModelDetailViewProps {
  draft: ReturnType<typeof useModelConfigStore.getState>["draft"];
  saving: boolean;
  testing: boolean;
  testResult: ReturnType<typeof useModelConfigStore.getState>["testResult"];
  onChange: (patch: Partial<ReturnType<typeof useModelConfigStore.getState>["draft"]>) => void;
  onDelete: () => void;
  onMarkDefault: () => void;
  onSave: () => void;
  onTest: () => void;
}

function ModelDetailView({
  draft,
  saving,
  testing,
  testResult,
  onChange,
  onDelete,
  onMarkDefault,
  onSave,
  onTest
}: ModelDetailViewProps) {
  return (
    <section className="model-form-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Model Detail</p>
          <h3>{draft.id ? "模型详情" : "新增模型"}</h3>
          <p className="muted">这里维护单个模型的调用信息。保存后会回到模型列表可选项中。</p>
        </div>
        <Badge tone={draft.enabled ? "sage" : "rose"}>{draft.enabled ? "启用" : "停用"}</Badge>
      </div>

      <div className="api-note">
        <strong>接口预留说明</strong>
        <p>
          当前表单调用 `modelConfigApi.ts` 的 mock 方法。后续后端完成后，只需要替换为
          `/api/v1/model-configs` 请求，页面和 store 不需要大改。
        </p>
      </div>

      <form className="model-form" onSubmit={(event) => event.preventDefault()}>
        <label className="field">
          <span>配置名称</span>
          <input
            value={draft.name}
            placeholder="例如：长篇正文写作模型"
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </label>

        <div className="field">
          <span>服务商</span>
          <SelectField
            value={draft.provider}
            options={providerOptions.map((option) => ({
              label: option.label,
              value: option.value,
              description: option.hint
            }))}
            onChange={(value) => onChange({ provider: value as ModelProvider })}
          />
          <small>{providerOptions.find((option) => option.value === draft.provider)?.hint}</small>
        </div>

        <label className="field">
          <span>Base URL</span>
          <input
            value={draft.baseUrl}
            placeholder="https://api.example.com/v1"
            onChange={(event) => onChange({ baseUrl: event.target.value })}
          />
        </label>

        <label className="field">
          <span>模型名称</span>
          <input
            value={draft.model}
            placeholder="例如：deepseek-chat / qwen2.5:7b"
            onChange={(event) => onChange({ model: event.target.value })}
          />
        </label>

        <label className="field">
          <span>API Key</span>
          <input
            type="password"
            value={draft.apiKey}
            placeholder="第一版前端暂存，后续交给后端加密保存"
            onChange={(event) => onChange({ apiKey: event.target.value })}
          />
          <small>真实版本不要让浏览器长期保存密钥，后端应写入本地 secrets 文件。</small>
        </label>

        <div className="field">
          <span>模型用途</span>
          <SelectField
            value={draft.purpose}
            options={purposeOptions}
            onChange={(value) => onChange({ purpose: value as ModelPurpose })}
          />
        </div>

        <label className="field compact">
          <span>温度</span>
          <input
            max="2"
            min="0"
            step="0.01"
            type="number"
            value={draft.temperature}
            onChange={(event) => onChange({ temperature: Number(event.target.value) })}
          />
        </label>

        <label className="field compact">
          <span>最大 Token</span>
          <input
            min="256"
            step="256"
            type="number"
            value={draft.maxTokens}
            onChange={(event) => onChange({ maxTokens: Number(event.target.value) })}
          />
        </label>

        <label className="field full">
          <span>备注</span>
          <textarea
            value={draft.note}
            placeholder="记录这个模型适合做什么、费用如何、是否偏文学风格等。"
            onChange={(event) => onChange({ note: event.target.value })}
          />
        </label>

        <div className="toggle-row">
          <label className="inline-switch">
            <input
              checked={draft.enabled}
              type="checkbox"
              onChange={(event) => onChange({ enabled: event.target.checked })}
            />
            <span>启用此配置</span>
          </label>
          <label className="inline-switch">
            <input
              checked={draft.isDefault}
              type="checkbox"
              onChange={(event) => onChange({ isDefault: event.target.checked })}
            />
            <span>保存时标记为默认</span>
          </label>
        </div>

        {testResult ? (
          <div className={`test-banner ${testResult.ok ? "success" : "failed"}`}>
            {testResult.message}
          </div>
        ) : null}

        <div className="button-row">
          <button className="primary-button" type="button" disabled={saving} onClick={onSave}>
            {saving ? "保存中..." : "保存配置"}
          </button>
          <button className="ghost-button" type="button" disabled={testing} onClick={onTest}>
            {testing ? "测试中..." : "测试连接"}
          </button>
          {draft.id ? (
            <>
              <button className="ghost-button" type="button" disabled={saving} onClick={onMarkDefault}>
                设为默认模型
              </button>
              <button className="danger-button" type="button" disabled={saving} onClick={onDelete}>
                删除
              </button>
            </>
          ) : null}
        </div>
      </form>
    </section>
  );
}

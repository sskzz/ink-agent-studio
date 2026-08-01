import { useEffect, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { discoverAvailableModels } from "@/shared/api/modelConfigApi";
import { providerOptions, purposeLabel, purposeOptions } from "@/config/modelOptions";
import { Badge } from "@/shared/components/ui/Badge";
import { PageHeader } from "@/shared/components/ui/PageHeader";
import { SelectField } from "@/shared/components/ui/SelectField";
import { ModelAnalysisPanel } from "@/features/models/components/ModelAnalysisPanel";
import { useModelConfigStore } from "@/shared/stores/modelConfigStore";
import type { ModelConfig, ModelProvider, ModelPurpose } from "@/shared/types/domain";

type ModelView = "types" | "list" | "detail" | "planning" | "writing" | "review";

/**
 * 模型配置页。
 *
 * 页面结构按“模型类型入口 -> 模型列表/用途分配 -> 模型详情”组织：
 * - 模型列表：管理所有可调用模型。
 * - 写作模型：从模型列表中选择 Agent 写正文时使用的模型。
 * - 审稿模型：从模型列表中选择审稿/修订时使用的模型。
 *
 * 当前已通过 modelConfigApi.ts 接入本地 Hono 后端，页面和 store 不直接关心 fetch 细节。
 */
export function ModelsPage() {
  const [view, setView] = useState<ModelView>("types");

  const {
    analysis,
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
  const planningConfig = configs.find((config) => config.id === usage.planningModelId);

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

      <ModelAnalysisPanel analysis={analysis} loading={loading} />

      {error ? <div className="test-banner failed">{error}</div> : null}

      {/* key 跟随模型子视图变化，点击模型类型/列表/详情时会触发轻量切换动效。 */}
      <div className="model-view-transition" key={view}>
        {view === "types" ? (
          <ModelTypeLanding
            configsCount={configs.length}
            loading={loading}
            planningConfig={planningConfig}
            reviewConfig={reviewConfig}
            writingConfig={writingConfig}
            onOpenList={() => setView("list")}
            onOpenPlanning={() => setView("planning")}
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
            onBack={backToTypes}
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
            onBack={backToTypes}
            onAssign={(modelId) => void assignPurposeModel("writing", modelId)}
            onOpenDetail={openDetail}
          />
        ) : null}

        {view === "planning" ? (
          <PurposeModelView
            configs={configs}
            currentId={usage.planningModelId}
            saving={saving}
            title="规划模型"
            description="选择用于作品初始化、世界观与角色设定、卷纲章节奏和伏笔布局的模型。"
            actionLabel="设为规划模型"
            onBack={backToTypes}
            onAssign={(modelId) => void assignPurposeModel("planning", modelId)}
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
            onBack={backToTypes}
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
            onBack={() => setView("list")}
            onChange={updateDraft}
            onDelete={() => draft.id && void removeConfig(draft.id)}
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
  planningConfig?: ModelConfig;
  onOpenList: () => void;
  onOpenWriting: () => void;
  onOpenReview: () => void;
  onOpenPlanning: () => void;
}

function ModelTypeLanding({
  configsCount,
  loading,
  writingConfig,
  reviewConfig,
  planningConfig,
  onOpenList,
  onOpenWriting,
  onOpenReview,
  onOpenPlanning
}: ModelTypeLandingProps) {
  return (
    <section className="model-type-grid" aria-label="模型类型">
      <button className="model-type-card" type="button" onClick={onOpenList}>
        <Badge tone="blue">{loading ? "加载中" : `${configsCount} 个配置`}</Badge>
        <h3>模型列表</h3>
        <p>查看、新增和维护所有模型配置。点击具体模型后进入详情表单。</p>
      </button>

      <button className="model-type-card" type="button" onClick={onOpenPlanning}>
        <Badge tone="blue">规划链路</Badge>
        <h3>规划模型</h3>
        <p>当前：{planningConfig?.name ?? "未设置"}。用于作品初始化、设定生成、卷纲拆解和伏笔规划。</p>
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
  onBack: () => void;
  onCreate: () => void;
  onOpenDetail: (config: ModelConfig) => void;
}

function ModelListView({ configs, loading, selectedId, onBack, onCreate, onOpenDetail }: ModelListViewProps) {
  return (
    <section className="model-list-view">
      <div className="section-title">
        <div>
          <p className="eyebrow">Model List</p>
          <h3>模型列表</h3>
          <p className="muted">这里展示所有已配置模型。点击模型卡片进入详情，点击“新增模型”创建新配置。</p>
        </div>
        <div className="button-row">
          <button className="ghost-button" type="button" onClick={onBack}>
            <ArrowLeft size={16} aria-hidden="true" />
            返回模型类型
          </button>
          <button className="primary-button" type="button" onClick={onCreate}>
            新增模型
          </button>
        </div>
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
  onBack: () => void;
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
  onBack,
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
        <button className="ghost-button" type="button" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          返回模型类型
        </button>
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
                  <p>{config.apiModel}</p>
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
                  data-loading={saving && !isCurrent ? "true" : undefined}
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
      <p>{config.apiModel}</p>
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
  onBack: () => void;
  onChange: (patch: Partial<ReturnType<typeof useModelConfigStore.getState>["draft"]>) => void;
  onDelete: () => void;
  onSave: () => void;
  onTest: () => void;
}

function ModelDetailView({
  draft,
  saving,
  testing,
  testResult,
  onBack,
  onChange,
  onDelete,
  onSave,
  onTest
}: ModelDetailViewProps) {
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [discoveringModels, setDiscoveringModels] = useState(false);
  const [modelDiscoveryError, setModelDiscoveryError] = useState("");
  const currentApiModelMissing =
    availableModels.length > 0 && draft.apiModel.trim().length > 0 && !availableModels.includes(draft.apiModel);
  const apiModelOptions = [
    ...(currentApiModelMissing
      ? [
          {
            label: draft.apiModel,
            value: draft.apiModel,
            description: "当前保存，未出现在最新列表"
          }
        ]
      : []),
    ...availableModels.map((model) => ({ label: model, value: model }))
  ];

  async function handleDiscoverModels() {
    setDiscoveringModels(true);
    setModelDiscoveryError("");

    try {
      const models = await discoverAvailableModels(draft);
      setAvailableModels(models);
      if (!draft.apiModel.trim() && models[0]) {
        onChange({ apiModel: models[0] });
      }
      if (models.length === 0) {
        setModelDiscoveryError("API 未返回可用模型。");
      }
    } catch (error) {
      setAvailableModels([]);
      setModelDiscoveryError(error instanceof Error ? error.message : "获取模型列表失败");
    } finally {
      setDiscoveringModels(false);
    }
  }

  return (
    <section className="model-form-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Model Detail</p>
          <h3>{draft.id ? "模型详情" : "新增模型"}</h3>
          <p className="muted">这里维护单个模型的调用信息。保存后会回到模型列表可选项中。</p>
        </div>
        <div className="button-row">
          <button className="ghost-button" type="button" onClick={onBack}>
            <ArrowLeft size={16} aria-hidden="true" />
            返回模型列表
          </button>
          <Badge tone={draft.enabled ? "sage" : "rose"}>{draft.enabled ? "启用" : "停用"}</Badge>
        </div>
      </div>

      <div className="api-note">
        <strong>后端接口说明</strong>
        <p>
          当前表单通过 `modelConfigApi.ts` 调用 `/api/v1/model-configs`，API Key 由后端写入本地
          secrets 文件，普通配置接口不会回传真实密钥。
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

        <div className="field">
          <span>API 调用模型</span>
          <div className="model-discovery-row">
            <SelectField
              value={apiModelOptions.some((option) => option.value === draft.apiModel) ? draft.apiModel : ""}
              options={apiModelOptions}
              placeholder={draft.apiModel || "请先获取模型列表"}
              disabled={apiModelOptions.length === 0}
              onChange={(apiModel) => onChange({ apiModel })}
            />
            <button
              className="ghost-button"
              type="button"
              data-loading={discoveringModels ? "true" : undefined}
              disabled={discoveringModels || !draft.baseUrl.trim()}
              onClick={() => void handleDiscoverModels()}
            >
              <RefreshCw size={16} aria-hidden="true" />
              {discoveringModels ? "获取中..." : "获取模型列表"}
            </button>
          </div>
          {modelDiscoveryError ? <small>{modelDiscoveryError}</small> : null}
          {!modelDiscoveryError && availableModels.length === 0 && draft.apiModel ? (
            <small>当前保存：{draft.apiModel}</small>
          ) : null}
          {currentApiModelMissing ? <small>当前保存的模型未出现在最新列表中。</small> : null}
          {availableModels.length > 0 && draft.apiModel ? (
            <small>保存后，此 API 配置将调用「{draft.apiModel}」。</small>
          ) : null}
        </div>

        <label className="field">
          <span>API Key</span>
          <input
            type="password"
            value={draft.apiKey}
            placeholder="留空表示不修改已保存密钥"
            onChange={(event) => onChange({ apiKey: event.target.value })}
          />
          <small>密钥只在提交时发送给后端，列表和详情接口不会回显真实 API Key。</small>
        </label>

        <div className="field">
          <span>模型用途</span>
          <SelectField
            value={draft.purpose}
            options={purposeOptions}
            onChange={(value) => onChange({ purpose: value as ModelPurpose })}
          />
        </div>

        <fieldset className="field">
          <legend>成本估算（可选）</legend>
          <div className="form-grid two-columns">
            <label className="field">
              <span>币种</span>
              <input
                value={draft.capabilities.pricing?.currency ?? ""}
                placeholder="USD"
                maxLength={3}
                onChange={(event) => onChange({
                  capabilities: updatePricing(draft.capabilities, "currency", event.target.value.toUpperCase())
                })}
              />
            </label>
            <label className="field">
              <span>输入价格（每百万 Token）</span>
              <input
                type="number"
                min="0"
                step="0.000001"
                value={microsToUnits(draft.capabilities.pricing?.promptMicrosPerMillionTokens)}
                placeholder="留空则不估算"
                onChange={(event) => onChange({
                  capabilities: updatePricing(draft.capabilities, "promptMicrosPerMillionTokens", unitsToMicros(event.target.value))
                })}
              />
            </label>
            <label className="field">
              <span>输出价格（每百万 Token）</span>
              <input
                type="number"
                min="0"
                step="0.000001"
                value={microsToUnits(draft.capabilities.pricing?.completionMicrosPerMillionTokens)}
                placeholder="留空则不估算"
                onChange={(event) => onChange({
                  capabilities: updatePricing(draft.capabilities, "completionMicrosPerMillionTokens", unitsToMicros(event.target.value))
                })}
              />
            </label>
          </div>
          <small>价格不会自动猜测；填写币种和输入/输出单价后，Run 才会记录估算成本。</small>
        </fieldset>

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
          <button
            className="primary-button"
            type="button"
            data-loading={saving ? "true" : undefined}
            disabled={saving}
            onClick={onSave}
          >
            {saving ? "保存中..." : "保存配置"}
          </button>
          <button
            className="ghost-button"
            type="button"
            data-loading={testing ? "true" : undefined}
            disabled={testing}
            onClick={onTest}
          >
            {testing ? "测试中..." : "测试连接"}
          </button>
          {draft.id ? (
            <button
              className="danger-button"
              type="button"
              data-loading={saving ? "true" : undefined}
              disabled={saving}
              onClick={onDelete}
            >
              {saving ? "删除中..." : "删除"}
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function microsToUnits(value: number | undefined) {
  return value === undefined ? "" : String(value / 1_000_000);
}

function unitsToMicros(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 1_000_000) : undefined;
}

function updatePricing(
  capabilities: ModelConfig["capabilities"],
  field: "currency" | "promptMicrosPerMillionTokens" | "completionMicrosPerMillionTokens",
  value: string | number | undefined
): ModelConfig["capabilities"] {
  const current = capabilities.pricing ?? {};
  const pricing = { ...current, [field]: value };
  const hasAnyValue = Object.values(pricing).some((item) => item !== undefined && item !== "");
  return { ...capabilities, pricing: hasAnyValue ? pricing : undefined };
}

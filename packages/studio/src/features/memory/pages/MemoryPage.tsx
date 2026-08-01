import type {
  UserMemorySelection,
  UserPreference,
  UserPreferenceProposalInput
} from "@ink-agent/contracts";
import { Archive, Check, Plus, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  approvePreference,
  archivePreference,
  listPreferences,
  previewMemoryPrompt,
  proposePreference,
  rejectPreference
} from "@/shared/api/memoryApi";
import { Badge } from "@/shared/components/ui/Badge";
import { PageHeader } from "@/shared/components/ui/PageHeader";

const statusOptions: Array<{ value: "all" | UserPreference["status"]; label: string }> = [
  { value: "all", label: "全部" },
  { value: "proposed", label: "待审批" },
  { value: "active", label: "已启用" },
  { value: "archived", label: "已归档" },
  { value: "rejected", label: "已拒绝" }
];

const statusLabels: Record<UserPreference["status"], string> = {
  proposed: "待审批",
  active: "已启用",
  archived: "已归档",
  rejected: "已拒绝"
};

const keyLabels: Record<UserPreference["key"], string> = {
  narrative_pacing: "叙事节奏",
  paragraph_length: "段落长度",
  dialogue_density: "对白密度",
  description_density: "描写密度",
  emotion_expression: "情绪表达",
  banned_expressions: "禁用表达",
  review_strictness: "审稿严格度",
  revision_scope: "修订范围",
  output_format: "输出格式",
  interaction_style: "协作方式"
};

const categoryLabels: Record<UserPreference["category"], string> = {
  writing: "写作",
  review: "审稿",
  workflow: "工作流",
  formatting: "格式"
};

const initialProposal: UserPreferenceProposalInput = {
  category: "writing",
  key: "narrative_pacing",
  value: "",
  reason: "",
  priority: 50,
  sourceSessionId: null,
  sourceMessageId: null
};

export function MemoryPage() {
  const [preferences, setPreferences] = useState<UserPreference[]>([]);
  const [preview, setPreview] = useState<UserMemorySelection | null>(null);
  const [filter, setFilter] = useState<"all" | UserPreference["status"]>("all");
  const [proposal, setProposal] = useState<UserPreferenceProposalInput>(initialProposal);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<string | null>("load");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void reload();
  }, []);

  const filtered = useMemo(
    () => filter === "all" ? preferences : preferences.filter((item) => item.status === filter),
    [filter, preferences]
  );

  async function reload() {
    setBusy("load");
    setMessage("");
    try {
      const [items, promptPreview] = await Promise.all([listPreferences(), previewMemoryPrompt()]);
      setPreferences(items);
      setPreview(promptPreview);
    } catch (error) {
      setMessage(toErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function submitProposal(event: React.FormEvent) {
    event.preventDefault();
    setBusy("proposal");
    setMessage("");
    try {
      const created = await proposePreference(proposal);
      setPreferences((current) => [created, ...current]);
      setProposal(initialProposal);
      setShowForm(false);
      setFilter("proposed");
      setMessage("偏好提议已创建；批准前不会进入任何模型 Prompt。");
    } catch (error) {
      setMessage(toErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function approve(item: UserPreference) {
    await mutate(item.id, () => approvePreference(item.id), "偏好已批准并进入后续 Prompt。");
  }

  async function reject(item: UserPreference) {
    const reason = window.prompt("请输入拒绝原因（将单独保存，不会改写原提议理由）：");
    if (!reason?.trim()) return;
    await mutate(item.id, () => rejectPreference(item.id, reason.trim()), "偏好提议已拒绝。");
  }

  async function archive(item: UserPreference) {
    if (!window.confirm(`确认归档“${keyLabels[item.key]}”偏好？归档后不会再进入 Prompt。`)) return;
    await mutate(item.id, () => archivePreference(item.id), "偏好已归档并从 Prompt 移除。");
  }

  async function mutate(id: string, operation: () => Promise<UserPreference>, successMessage: string) {
    setBusy(id);
    setMessage("");
    try {
      const updated = await operation();
      setPreferences((current) => current.map((item) => item.id === updated.id ? updated : item));
      setPreview(await previewMemoryPrompt());
      setMessage(successMessage);
    } catch (error) {
      setMessage(toErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page memory-page">
      <PageHeader
        eyebrow="User Memory"
        title="偏好记忆"
        description="这里只保存稳定的写作与协作偏好。人物、剧情、世界观和伏笔仍以 BookState 的 JSON / Markdown 为唯一权威来源。"
        actions={
          <>
          <button className="ghost-button" type="button" disabled={busy !== null} onClick={() => void reload()}>
            <RefreshCw size={16} aria-hidden="true" />刷新
          </button>
          <button className="primary-button" type="button" onClick={() => setShowForm((current) => !current)}>
            <Plus size={16} aria-hidden="true" />新建偏好提议
          </button>
          </>
        }
      />

      <section className="memory-boundary-note">
        <strong>权威边界</strong>
        <span>偏好需要明确批准才会启用；偏好不能覆盖 BookState、当前指令或安全规则，Agent 也不会从会话中自动激活记忆。</span>
      </section>

      {showForm ? (
        <form className="memory-proposal-form" onSubmit={(event) => void submitProposal(event)}>
          <div className="memory-section-heading"><div><span>PROPOSAL</span><h3>创建待审批提议</h3></div></div>
          <div className="memory-form-grid">
            <label className="field">类别
              <select value={proposal.category} onChange={(event) => setProposal({ ...proposal, category: event.target.value as UserPreference["category"] })}>
                {Object.entries(categoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <label className="field">偏好类型
              <select value={proposal.key} onChange={(event) => setProposal({ ...proposal, key: event.target.value as UserPreference["key"] })}>
                {Object.entries(keyLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <label className="field">优先级（1–100）
              <input min={1} max={100} type="number" value={proposal.priority} onChange={(event) => setProposal({ ...proposal, priority: Number(event.target.value) })} />
            </label>
            <label className="field memory-wide-field">偏好内容
              <textarea maxLength={500} required value={proposal.value} placeholder="例如：动作场景优先使用短段落；不要填写角色姓名、剧情结局或世界设定。" onChange={(event) => setProposal({ ...proposal, value: event.target.value })} />
            </label>
            <label className="field memory-wide-field">为什么这是长期稳定偏好
              <textarea maxLength={500} required value={proposal.reason} placeholder="说明该偏好为什么应跨会话复用。" onChange={(event) => setProposal({ ...proposal, reason: event.target.value })} />
            </label>
          </div>
          <div className="memory-form-actions">
            <button className="primary-button" type="submit" disabled={busy !== null}>创建提议</button>
            <button className="ghost-button" type="button" onClick={() => setShowForm(false)}>取消</button>
          </div>
        </form>
      ) : null}

      <section className="memory-layout">
        <div className="memory-list-panel">
          <div className="memory-filter-bar" role="tablist" aria-label="偏好状态筛选">
            {statusOptions.map((option) => (
              <button className={filter === option.value ? "active" : ""} type="button" role="tab" aria-selected={filter === option.value} key={option.value} onClick={() => setFilter(option.value)}>
                {option.label}<span>{option.value === "all" ? preferences.length : preferences.filter((item) => item.status === option.value).length}</span>
              </button>
            ))}
          </div>
          {busy === "load" ? <p className="memory-empty">正在读取偏好记忆…</p> : null}
          {busy !== "load" && filtered.length === 0 ? <p className="memory-empty">当前状态下没有偏好记录。</p> : null}
          <div className="memory-list">
            {filtered.map((item) => (
              <article className="memory-item" key={item.id}>
                <div className="memory-item-head">
                  <div><span>{categoryLabels[item.category]} · 优先级 {item.priority}</span><h3>{keyLabels[item.key]}</h3></div>
                  <Badge tone={statusTone(item.status)}>{statusLabels[item.status]}</Badge>
                </div>
                <p className="memory-value">{item.value}</p>
                <dl className="memory-item-details"><div><dt>提议理由</dt><dd>{item.reason}</dd></div>{item.rejectionReason ? <div><dt>拒绝原因</dt><dd>{item.rejectionReason}</dd></div> : null}</dl>
                <div className="memory-item-foot">
                  <time dateTime={item.updatedAt}>{formatDate(item.updatedAt)}</time>
                  <div>
                    {item.status === "proposed" ? <>
                      <button className="primary-button" type="button" disabled={busy !== null} onClick={() => void approve(item)}><Check size={14} />批准</button>
                      <button className="danger-button" type="button" disabled={busy !== null} onClick={() => void reject(item)}><X size={14} />拒绝</button>
                    </> : null}
                    {item.status === "active" ? <button className="ghost-button" type="button" disabled={busy !== null} onClick={() => void archive(item)}><Archive size={14} />归档</button> : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>

        <aside className="memory-preview-panel">
          <div className="memory-section-heading"><div><span>PROMPT PREVIEW</span><h3>实际注入预览</h3></div><Badge tone={preview?.trace.enabled ? "sage" : "rose"}>{preview?.trace.enabled ? "已启用" : "已停用"}</Badge></div>
          <dl className="memory-preview-stats">
            <div><dt>扫描 Active</dt><dd>{preview?.trace.activeScanned ?? 0}</dd></div>
            <div><dt>已选择</dt><dd>{preview?.trace.selectedIds.length ?? 0}</dd></div>
            <div><dt>Token</dt><dd>{preview?.trace.totalEstimatedTokens ?? 0} / {preview?.trace.promptTokenBudget ?? 0}</dd></div>
          </dl>
          <pre>{preview?.prompt || "当前没有会进入 Prompt 的已批准偏好。"}</pre>
          <p>预览只显示 Memory 层；作品事实位于独立 Facts 层，后续指令位于 Turn 层。</p>
        </aside>
      </section>
      <p className={message.includes("失败") || message.includes("错误") ? "anti-ai-state error" : "muted"} aria-live="polite">{message}</p>
    </div>
  );
}

function statusTone(status: UserPreference["status"]): "sage" | "amber" | "blue" | "rose" {
  if (status === "active") return "sage";
  if (status === "proposed") return "amber";
  if (status === "archived") return "blue";
  return "rose";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "偏好记忆操作失败";
}

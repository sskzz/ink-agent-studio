import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Pencil, X } from "lucide-react";
import { Badge } from "@/shared/components/ui/Badge";
import type {
  LegacyKnowledgeBackfillPreview,
  LegacyKnowledgeBackfillProposal
} from "@/features/knowledge/api/storyKnowledgeApi";

interface BackfillReviewPanelProps {
  proposal: LegacyKnowledgeBackfillProposal;
  preview: LegacyKnowledgeBackfillPreview | null;
  busy: boolean;
  error: string;
  onReview(itemKey: string, input: { status: "accepted" | "rejected"; editedValue?: unknown; reason?: string }): void;
  onApply(): void;
}

export function BackfillReviewPanel({ proposal, preview, busy, error, onReview, onApply }: BackfillReviewPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editorValue, setEditorValue] = useState("");
  const [editorError, setEditorError] = useState("");
  const decisions = useMemo(() => new Map(proposal.decisions.map((item) => [item.itemKey, item])), [proposal.decisions]);
  const items = useMemo(() => backfillItems(proposal), [proposal]);

  useEffect(() => {
    if (editingKey && !items.some((item) => item.itemKey === editingKey)) setEditingKey(null);
  }, [editingKey, items]);

  function startEdit(itemKey: string, value: unknown) {
    setEditingKey(itemKey);
    setEditorValue(JSON.stringify(decisions.get(itemKey)?.editedValue ?? value, null, 2));
    setEditorError("");
  }

  function acceptEdited() {
    if (!editingKey) return;
    try {
      onReview(editingKey, { status: "accepted", editedValue: JSON.parse(editorValue), reason: "人工编辑并接受" });
      setEditingKey(null);
      setEditorError("");
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : "JSON 格式无效");
    }
  }

  return (
    <section className="knowledge-backfill-review">
      <header>
        <div>
          <strong>旧作品逐项回填审核</strong>
          <span>提案不修改权威知识；只有已接受条目才会进入应用预览。</span>
        </div>
        <button className="ghost-button" type="button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          {expanded ? "收起审核" : "展开审核"}
        </button>
      </header>
      <div className="backfill-review-summary">
        <Badge tone={proposal.status === "applied" ? "sage" : "amber"}>{proposal.status === "applied" ? "已应用" : "待审核"}</Badge>
        <span>接受 {preview?.counts.accepted ?? countStatus(proposal, "accepted")}</span>
        <span>拒绝 {preview?.counts.rejected ?? countStatus(proposal, "rejected")}</span>
        <span>待审 {preview?.counts.pending ?? countStatus(proposal, "pending")}</span>
        {preview ? <span>预计新增 {preview.counts.willCreate} 项</span> : null}
        {proposal.status === "proposed" ? (
          <button className="primary-button" disabled={busy || !preview?.ready} type="button" onClick={onApply}>
            应用已接受条目
          </button>
        ) : null}
      </div>
      {error ? <p className="knowledge-inline-error">{error}</p> : null}
      {expanded ? (
        <div className="backfill-review-list">
          {items.map((item) => {
            const decision = decisions.get(item.itemKey);
            const outcome = preview?.items.find((entry) => entry.itemKey === item.itemKey)?.outcome;
            return (
              <article key={item.itemKey} data-status={decision?.status ?? "pending"}>
                <header>
                  <div><strong>{item.label}</strong><small>{item.description}</small></div>
                  <div>
                    <Badge tone={decision?.status === "accepted" ? "sage" : decision?.status === "rejected" ? "rose" : "amber"}>
                      {decision?.status === "accepted" ? "已接受" : decision?.status === "rejected" ? "已拒绝" : "待审核"}
                    </Badge>
                    {outcome ? <small>{outcomeLabel(outcome)}</small> : null}
                  </div>
                </header>
                {editingKey === item.itemKey ? (
                  <div className="backfill-json-editor">
                    <textarea value={editorValue} onChange={(event) => setEditorValue(event.target.value)} />
                    {editorError ? <small className="knowledge-inline-error">{editorError}</small> : null}
                    <div>
                      <button className="ghost-button" type="button" onClick={() => setEditingKey(null)}>取消</button>
                      <button className="primary-button" disabled={busy} type="button" onClick={acceptEdited}>校验并接受</button>
                    </div>
                  </div>
                ) : (
                  <div className="backfill-review-actions">
                    <button className="ghost-button" disabled={busy} type="button" onClick={() => onReview(item.itemKey, { status: "rejected", reason: "人工拒绝" })}><X size={14} />拒绝</button>
                    <button className="ghost-button" disabled={busy} type="button" onClick={() => startEdit(item.itemKey, item.value)}><Pencil size={14} />编辑</button>
                    <button className="primary-button" disabled={busy} type="button" onClick={() => onReview(item.itemKey, { status: "accepted", reason: "人工审核通过" })}><Check size={14} />接受</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function backfillItems(proposal: LegacyKnowledgeBackfillProposal) {
  return [
    ...(proposal.storyPlan ? [{ itemKey: "story-plan", label: "三层大纲", description: `${proposal.storyPlan.plannedChapterCount} 章 · ${proposal.storyPlan.volumes.length} 卷`, value: proposal.storyPlan }] : []),
    ...(proposal.worldRules?.rules ?? []).map((rule) => ({ itemKey: `world-rule:${rule.id}`, label: `世界规则 · ${rule.title}`, description: rule.content, value: rule })),
    ...proposal.characterProfiles.map((item) => ({ itemKey: `character-profile:${item.entityId}`, label: `人物档案 · ${item.characterName}`, description: item.entityId, value: item.profile }))
  ];
}

function countStatus(proposal: LegacyKnowledgeBackfillProposal, status: "pending" | "accepted" | "rejected") {
  return proposal.decisions.filter((item) => item.status === status).length;
}

function outcomeLabel(outcome: LegacyKnowledgeBackfillPreview["items"][number]["outcome"]) {
  return ({ will_create: "将新增", skip_existing: "已有权威数据，跳过", skip_rejected: "已拒绝", pending: "待裁决", missing_target: "目标已不存在" })[outcome];
}

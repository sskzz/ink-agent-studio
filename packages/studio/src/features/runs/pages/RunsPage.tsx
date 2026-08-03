/**
 * 运行记录页：运行列表、事件流（SSE 实时订阅）、模型尝试与状态补丁审批。
 * 列表每 10s 轮询刷新；选中运行后通过 EventSource 订阅事件并随事件失效相关查询；
 * 模型尝试在运行非终态时每 2s 轮询。
 */
import type { ModelAttempt, RunEvent, RunSnapshot, StatePatch } from "@ink-agent/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, RefreshCw, RotateCcw, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/shared/components/ui/Badge";
import { PageHeader } from "@/shared/components/ui/PageHeader";
import {
  applyPatch,
  cancelRun,
  getRun,
  listBookPatches,
  listModelAttempts,
  listRuns,
  rejectPatch,
  resumeRun,
  subscribeRunEvents
} from "../api/runsApi";

/** 运行终态集合：进入这些状态后停止轮询与事件订阅。 */
const terminalStatuses = new Set<RunSnapshot["status"]>(["cancelled", "completed", "failed", "interrupted"]);

/** 运行记录页主组件：管理选中运行、事件列表与各异步查询的联动。 */
export function RunsPage() {
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [streamError, setStreamError] = useState("");
  const [actionError, setActionError] = useState("");
  // 运行列表固定 10s 轮询，覆盖后台 Agent 任务的状态变化。
  const runsQuery = useQuery({ queryKey: ["runs"], queryFn: () => listRuns(100), refetchInterval: 10_000 });
  const runs = runsQuery.data ?? [];

  // 首次进入默认选中第一条运行，让详情区不为空。
  useEffect(() => {
    if (!selectedRunId && runs[0]) setSelectedRunId(runs[0].id);
  }, [runs, selectedRunId]);

  const runQuery = useQuery({
    queryKey: ["run", selectedRunId],
    queryFn: () => getRun(selectedRunId!),
    enabled: Boolean(selectedRunId)
  });
  const selectedRun = runQuery.data ?? runs.find((run) => run.id === selectedRunId) ?? null;
  // 模型尝试仅在运行未结束时高频轮询，终态后停表省资源。
  const attemptsQuery = useQuery({
    queryKey: ["run-model-attempts", selectedRunId],
    queryFn: () => listModelAttempts(selectedRunId!),
    enabled: Boolean(selectedRunId),
    refetchInterval: selectedRun && !terminalStatuses.has(selectedRun.status) ? 2_000 : false
  });
  const patchesQuery = useQuery({
    queryKey: ["patches", selectedRun?.bookId],
    queryFn: () => listBookPatches(selectedRun!.bookId!),
    enabled: Boolean(selectedRun?.bookId)
  });

  // 订阅选中运行的事件流：切换运行或组件卸载时重新订阅/取消；
  // 事件按 seq 去重排序，run_*/model_attempt_* 事件分别失效对应查询。
  useEffect(() => {
    if (!selectedRunId) return;
    setEvents([]);
    setStreamError("");
    return subscribeRunEvents(
      selectedRunId,
      (event) => {
        setEvents((current) => {
          if (current.some((item) => item.seq === event.seq)) return current;
          return [...current, event].sort((left, right) => left.seq - right.seq);
        });
        if (event.type.startsWith("run_") || event.type === "cancel_requested") {
          void queryClient.invalidateQueries({ queryKey: ["runs"] });
          void queryClient.invalidateQueries({ queryKey: ["run", selectedRunId] });
        }
        if (event.type.startsWith("model_attempt_")) {
          void queryClient.invalidateQueries({ queryKey: ["run-model-attempts", selectedRunId] });
        }
      },
      () => {
        if (!terminalStatuses.has(selectedRun?.status ?? "queued")) setStreamError("事件流已断开");
      }
    );
  }, [queryClient, selectedRunId]);

  /** 统一执行运行操作（取消/恢复/补丁审批）：成功后失效相关查询，失败时展示错误。 */
  async function runAction(action: () => Promise<unknown>) {
    setActionError("");
    try {
      await action();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["runs"] }),
        queryClient.invalidateQueries({ queryKey: ["run", selectedRunId] }),
        queryClient.invalidateQueries({ queryKey: ["patches", selectedRun?.bookId] })
      ]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="page runs-monitor-page">
      <PageHeader
        eyebrow="Runs"
        title="运行记录"
        description={`${runs.length} 条运行记录；可查看事件、模型尝试和状态补丁。`}
        actions={
          <button className="ghost-button" type="button" onClick={() => void runsQuery.refetch()} title="刷新运行记录">
            <RefreshCw size={16} /> 刷新
          </button>
        }
      />

      {runsQuery.isError ? <p className="anti-ai-state error">{String(runsQuery.error)}</p> : null}
      {actionError ? <p className="anti-ai-state error" aria-live="polite">{actionError}</p> : null}

      <div className="runs-monitor-layout">
        <section className="runs-table" aria-label="运行列表">
          <div className="runs-table-head"><span>状态</span><span>命令</span><span>作品</span><span>更新时间</span></div>
          {runs.map((run) => (
            <button
              className={`runs-table-row ${run.id === selectedRunId ? "active" : ""}`}
              key={run.id}
              type="button"
              onClick={() => setSelectedRunId(run.id)}
            >
              <Badge tone={statusTone(run.status)}>{statusLabel(run.status)}</Badge>
              <strong>{commandLabel(run.command.type)}</strong>
              <span>{shortId(run.bookId)}</span>
              <time>{formatTime(run.updatedAt)}</time>
            </button>
          ))}
          {!runsQuery.isLoading && runs.length === 0 ? <div className="runs-empty">暂无运行记录</div> : null}
        </section>

        <section className="run-detail-panel">
          {selectedRun ? (
            <>
              <div className="run-detail-heading">
                <div><span>Run</span><strong>{selectedRun.id}</strong></div>
                <div className="run-detail-actions">
                  {selectedRun.status === "interrupted" ? (
                    <button className="ghost-button" type="button" onClick={() => void runAction(() => resumeRun(selectedRun.id))}>
                      <RotateCcw size={15} /> 恢复
                    </button>
                  ) : null}
                  {["queued", "running", "cancelling"].includes(selectedRun.status) ? (
                    <button className="danger-button" type="button" onClick={() => void runAction(() => cancelRun(selectedRun.id))}>
                      <Ban size={15} /> 取消
                    </button>
                  ) : null}
                </div>
              </div>

              <dl className="run-facts">
                <div><dt>状态</dt><dd>{statusLabel(selectedRun.status)}</dd></div>
                <div><dt>阶段</dt><dd>{selectedRun.currentStage ?? "-"}</dd></div>
                <div><dt>事件</dt><dd>{selectedRun.lastEventSeq + 1}</dd></div>
                <div><dt>配置</dt><dd>r{selectedRun.configRevision ?? "-"}</dd></div>
              </dl>

              <div className="run-event-log">
                <div className="run-section-title"><strong>事件</strong><span>{streamError || `${events.length} 条`}</span></div>
                {events.map((event) => (
                  <div className="run-event-row" key={event.eventId}>
                    <span>{event.seq}</span><strong>{eventLabel(event.type)}</strong><small>{event.stage ?? formatTime(event.timestamp)}</small>
                  </div>
                ))}
              </div>

              <ModelAttemptsPanel attempts={attemptsQuery.data ?? []} loading={attemptsQuery.isLoading} />

              {selectedRun.output !== null || selectedRun.error !== null ? (
                <div className="run-output">
                  <div className="run-section-title"><strong>{selectedRun.error ? "错误" : "输出"}</strong></div>
                  <pre>{JSON.stringify(selectedRun.error ?? selectedRun.output, null, 2)}</pre>
                </div>
              ) : null}
            </>
          ) : <div className="runs-empty">选择一条运行记录</div>}
        </section>
      </div>

      {selectedRun?.bookId ? (
        <PatchApprovalPanel
          patches={patchesQuery.data ?? []}
          onApply={(patch) => void runAction(() => applyPatch(patch))}
          onReject={(patch) => void runAction(() => rejectPatch(patch.id))}
        />
      ) : null}
    </div>
  );
}

/** 模型尝试面板：聚合展示 token 消耗与估算费用，逐条列出每次调用。 */
function ModelAttemptsPanel({ attempts, loading }: { attempts: ModelAttempt[]; loading: boolean }) {
  const totalTokens = attempts.reduce((sum, attempt) => sum + (attempt.totalTokens ?? 0), 0);
  const costGroups = attempts.reduce<Record<string, number>>((groups, attempt) => {
    if (attempt.costCurrency && attempt.estimatedCostMicros !== null) {
      groups[attempt.costCurrency] = (groups[attempt.costCurrency] ?? 0) + attempt.estimatedCostMicros;
    }
    return groups;
  }, {});
  const costSummary = Object.entries(costGroups).map(([currency, micros]) =>
    `${currency} ${(micros / 1_000_000).toFixed(6)}`
  ).join(" · ");

  return (
    <div className="run-model-attempts">
      <div className="run-section-title">
        <strong>模型尝试</strong>
        <span>{attempts.length} 次 · {totalTokens} Token{costSummary ? ` · ${costSummary}` : ""}</span>
      </div>
      {attempts.map((attempt) => (
        <div className="run-model-attempt-row" key={attempt.id}>
          <Badge tone={attemptStatusTone(attempt.status)}>{attemptStatusLabel(attempt.status)}</Badge>
          <div><strong>{attempt.model ?? attempt.modelConfigId ?? "未知模型"}</strong><small>{attempt.provider ?? "-"} · {attempt.stage ?? attempt.purpose}</small></div>
          <span>{attempt.totalTokens === null ? "-" : `${attempt.totalTokens} Token`}</span>
          <span>{attempt.latencyMs === null ? "-" : `${attempt.latencyMs} ms`}</span>
          <span>{attempt.estimatedCostMicros === null || !attempt.costCurrency
            ? "-"
            : `${attempt.costCurrency} ${(attempt.estimatedCostMicros / 1_000_000).toFixed(6)}`}</span>
        </div>
      ))}
      {!loading && attempts.length === 0 ? <div className="runs-empty">本次运行暂无模型调用</div> : null}
    </div>
  );
}

/** 尝试状态 → 徽章配色：成功绿 / 运行蓝 / 超时琥珀 / 失败玫红。 */
function attemptStatusTone(status: ModelAttempt["status"]): "sage" | "amber" | "blue" | "rose" {
  if (status === "completed") return "sage";
  if (status === "running") return "blue";
  if (status === "timed_out") return "amber";
  return "rose";
}

const attemptStatusLabels: Record<ModelAttempt["status"], string> = {
  running: "调用中", completed: "成功", failed: "失败", cancelled: "已取消", timed_out: "超时"
};
/** 尝试状态 → 中文标签。 */
function attemptStatusLabel(status: ModelAttempt["status"]) { return attemptStatusLabels[status]; }

/** 待审批补丁面板：只展示 proposed 状态的补丁，应用/拒绝后由父级刷新。 */
function PatchApprovalPanel({ patches, onApply, onReject }: {
  patches: StatePatch[];
  onApply: (patch: StatePatch) => void;
  onReject: (patch: StatePatch) => void;
}) {
  // 只挑出仍处于待审批状态的补丁，已处理的不再展示。
  const proposed = useMemo(() => patches.filter((patch) => patch.status === "proposed"), [patches]);
  return (
    <section className="patch-approval-panel">
      <div className="run-section-title"><strong>待审批 Patch</strong><span>{proposed.length} 条</span></div>
      {proposed.map((patch) => (
        <div className="patch-approval-row" key={patch.id}>
          <div><strong>{targetLabel(patch)}</strong><p>{patch.reason}</p><code>{patch.baseHash.slice(0, 12)}</code></div>
          <div>
            <button className="primary-button" type="button" onClick={() => onApply(patch)}><ShieldCheck size={15} /> 应用</button>
            <button className="ghost-button" type="button" onClick={() => onReject(patch)}><X size={15} /> 拒绝</button>
          </div>
        </div>
      ))}
      {proposed.length === 0 ? <div className="runs-empty">暂无待审批 Patch</div> : null}
    </section>
  );
}

/** 运行状态 → 徽章配色。 */
function statusTone(status: RunSnapshot["status"]): "sage" | "amber" | "blue" | "rose" {
  if (status === "completed") return "sage";
  if (status === "running" || status === "queued") return "blue";
  if (status === "cancelling" || status === "interrupted") return "amber";
  return "rose";
}

const statusLabels: Record<RunSnapshot["status"], string> = {
  queued: "排队", running: "运行中", cancelling: "取消中", cancelled: "已取消",
  completed: "已完成", failed: "失败", interrupted: "已中断"
};
/** 运行状态 → 中文标签。 */
function statusLabel(status: RunSnapshot["status"]) { return statusLabels[status]; }
/** 命令/事件类型转可读文案：下划线转空格。 */
function commandLabel(type: string) { return type.replaceAll("_", " "); }
function eventLabel(type: string) { return type.replaceAll("_", " "); }
function shortId(value: string | null) { return value ? value.slice(0, 8) : "-"; }
/** 时间格式化：MM-DD HH:mm:ss，用于列表与详情中的时间展示。 */
function formatTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)); }
/** 补丁目标转可读文案：文件或章节。 */
function targetLabel(patch: StatePatch) { return patch.target.kind === "book_file" ? `文件 · ${patch.target.fileId}` : `章节 · ${patch.target.chapterId}`; }

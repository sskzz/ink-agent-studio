/**
 * 运行记录 API：运行快照、模型尝试、取消/暂停/恢复、状态补丁审批，
 * 以及基于 EventSource 的运行事件实时订阅。
 */
import {
  runEventTypeSchema,
  type RunEvent,
  type ModelAttempt,
  type RunSnapshot,
  type StatePatch
} from "@ink-agent/contracts";
import { API_BASE_URL, apiGet, apiPost } from "@/shared/api/http";

/** 运行列表：limit 控制返回条数，默认取最近 100 条。 */
export function listRuns(limit = 100) {
  return apiGet<RunSnapshot[]>(`/runs?limit=${limit}`);
}

/** 单个运行快照：含任务事件流与当前状态。 */
export function getRun(runId: string) {
  return apiGet<RunSnapshot>(`/runs/${runId}`);
}

/** 某次运行中的模型尝试列表（含失败重试与 token 消耗）。 */
export function listModelAttempts(runId: string) {
  return apiGet<ModelAttempt[]>(`/runs/${runId}/model-attempts`);
}

/** 取消运行：仅对运行中的任务有效，返回取消后的最新快照。 */
export function cancelRun(runId: string) {
  return apiPost<RunSnapshot>(`/runs/${runId}/cancel`);
}

/** 暂停运行：任务进入暂停态，等待用户审批或继续。 */
export function pauseRun(runId: string) {
  return apiPost<RunSnapshot>(`/runs/${runId}/pause`);
}

/** 恢复暂停的运行：返回新事件流地址供重新订阅。 */
export function resumeRun(runId: string) {
  return apiPost<{ runId: string; status: "queued"; eventsUrl: string; acceptedAt: string }>(`/runs/${runId}/resume`);
}

/** 某作品待审批的状态补丁列表（Agent 想改作品状态时先出补丁等用户确认）。 */
export function listBookPatches(bookId: string) {
  return apiGet<StatePatch[]>(`/books/${bookId}/patches`);
}

/** 批准补丁：携带期望的 baseHash 让后端做并发校验，避免基于过期状态应用。 */
export function applyPatch(patch: StatePatch) {
  return apiPost<StatePatch>(`/patches/${patch.id}/apply`, {
    approved: true,
    expectedBaseHash: patch.baseHash
  });
}

/** 拒绝补丁：reason 固定记录来源，便于运行记录里追溯。 */
export function rejectPatch(patchId: string) {
  return apiPost<StatePatch>(`/patches/${patchId}/reject`, { reason: "用户在运行记录页拒绝" });
}

/**
 * 订阅运行事件（SSE）：按契约中的事件类型逐一挂监听；onError 在网络异常时回调。
 * 终态事件采用“延迟关闭”：resume 同一 Run 时，旧终态事件会随重放先到达，其后的新事件
 * （run_queued → 各阶段 → 增量）在同一批重放里紧跟而来；**任何非终态事件都会取消待关闭
 * 计时器**，只有真正不再有新事件（终态后无后续）时才关闭连接，避免掐断实时更新。
 * 返回取消订阅函数供组件清理。
 */
export function subscribeRunEvents(
  runId: string,
  onEvent: (event: RunEvent) => void,
  onError: () => void,
  options: { afterSeq?: number } = {}
) {
  const afterSeq = Number.isSafeInteger(options.afterSeq) ? options.afterSeq : undefined;
  const query = afterSeq === undefined ? "" : `?after=${afterSeq}`;
  const source = new EventSource(`${API_BASE_URL}/runs/${runId}/events${query}`);
  // 这些事件代表运行进入终态，之后无需再保持订阅连接。
  const terminal = new Set(["run_cancelled", "run_completed", "run_failed", "run_interrupted"]);
  let closeTimer: number | undefined;
  const cancelClose = () => {
    if (closeTimer !== undefined) {
      window.clearTimeout(closeTimer);
      closeTimer = undefined;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer = window.setTimeout(() => {
      closeTimer = undefined;
      source.close();
    }, 800);
  };
  for (const eventType of runEventTypeSchema.options) {
    source.addEventListener(eventType, (message) => {
      try {
        const event = JSON.parse((message as MessageEvent<string>).data) as RunEvent;
        onEvent(event);
        if (terminal.has(event.type)) {
          scheduleClose();
        } else {
          cancelClose();
        }
      } catch {
        onError();
      }
    });
  }
  source.onerror = () => onError();
  return () => {
    cancelClose();
    source.close();
  };
}

import {
  runEventTypeSchema,
  type RunEvent,
  type ModelAttempt,
  type RunSnapshot,
  type StatePatch
} from "@ink-agent/contracts";
import { API_BASE_URL, apiGet, apiPost } from "@/shared/api/http";

export function listRuns(limit = 100) {
  return apiGet<RunSnapshot[]>(`/runs?limit=${limit}`);
}

export function getRun(runId: string) {
  return apiGet<RunSnapshot>(`/runs/${runId}`);
}

export function listModelAttempts(runId: string) {
  return apiGet<ModelAttempt[]>(`/runs/${runId}/model-attempts`);
}

export function cancelRun(runId: string) {
  return apiPost<RunSnapshot>(`/runs/${runId}/cancel`);
}

export function resumeRun(runId: string) {
  return apiPost<{ runId: string; status: "queued"; eventsUrl: string; acceptedAt: string }>(`/runs/${runId}/resume`);
}

export function listBookPatches(bookId: string) {
  return apiGet<StatePatch[]>(`/books/${bookId}/patches`);
}

export function applyPatch(patch: StatePatch) {
  return apiPost<StatePatch>(`/patches/${patch.id}/apply`, {
    approved: true,
    expectedBaseHash: patch.baseHash
  });
}

export function rejectPatch(patchId: string) {
  return apiPost<StatePatch>(`/patches/${patchId}/reject`, { reason: "用户在运行记录页拒绝" });
}

export function subscribeRunEvents(
  runId: string,
  onEvent: (event: RunEvent) => void,
  onError: () => void
) {
  const source = new EventSource(`${API_BASE_URL}/runs/${runId}/events`);
  const terminal = new Set(["run_cancelled", "run_completed", "run_failed", "run_interrupted"]);
  for (const eventType of runEventTypeSchema.options) {
    source.addEventListener(eventType, (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as RunEvent;
      onEvent(event);
      if (terminal.has(event.type)) source.close();
    });
  }
  source.onerror = () => onError();
  return () => source.close();
}

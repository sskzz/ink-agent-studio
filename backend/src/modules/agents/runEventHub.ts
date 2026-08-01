import type { RunEvent } from "@ink-agent/contracts";

export type RunEventListener = (event: RunEvent) => void;

/**
 * 进程内事件总线只负责唤醒在线 SSE 订阅者，SQLite 仍是唯一事实源。订阅者断线重连时按
 * seq 从数据库重放，因此服务重启或前端短暂离线都不会依赖这张内存表保存事件。
 */
export class RunEventHub {
  private readonly listeners = new Map<string, Set<RunEventListener>>();

  publish(event: RunEvent) {
    for (const listener of this.listeners.get(event.runId) ?? []) {
      listener(event);
    }
  }

  subscribe(runId: string, listener: RunEventListener) {
    const runListeners = this.listeners.get(runId) ?? new Set<RunEventListener>();
    runListeners.add(listener);
    this.listeners.set(runId, runListeners);

    return () => {
      runListeners.delete(listener);
      if (runListeners.size === 0) this.listeners.delete(runId);
    };
  }
}

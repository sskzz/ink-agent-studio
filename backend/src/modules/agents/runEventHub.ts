import type { RunEvent } from "@ink-agent/contracts";

/** SSE 事件监听器签名：接收一条已持久化的运行事件。 */
export type RunEventListener = (event: RunEvent) => void;

/**
 * 进程内事件总线（文件职责）。
 * 只负责把新事件实时推送给在线 SSE 订阅者，SQLite 仍是唯一事实源：订阅者断线重连时按
 * seq 从数据库重放，因此服务重启或前端短暂离线都不会依赖这张内存表保存事件。
 * 边界：不持久化、不做缓冲、不按 seq 去重（去重由订阅端与重放逻辑负责）。
 */
export class RunEventHub {
  /** 每个 runId 对应一组监听器；同一 run 可被多个 SSE 连接同时订阅。 */
  private readonly listeners = new Map<string, Set<RunEventListener>>();

  /**
   * 发布事件：同步唤醒该 run 的全部监听器。
   * 入参：event——已写入 SQLite 的完整运行事件。
   * 注意：发布者必须先落库再 publish，否则订阅端收到的事件无法在重放路径下对账。
   */
  publish(event: RunEvent) {
    for (const listener of this.listeners.get(event.runId) ?? []) {
      listener(event);
    }
  }

  /**
   * 订阅指定 run 的事件流。
   * 入参：runId——目标运行；listener——事件回调。
   * 返回值：取消订阅函数（同时清理空分组，避免 Map 泄漏）。
   */
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

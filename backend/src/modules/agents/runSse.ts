import type { RunEvent } from "@ink-agent/contracts";
import type { RunEventHub } from "./runEventHub.js";
import type { RunEventStore } from "./runEventStore.js";

const terminalEventTypes = new Set<RunEvent["type"]>([
  "run_cancelled",
  "run_completed",
  "run_failed",
  "run_interrupted"
]);

interface RunSseOptions {
  afterSeq: number;
  replayLimit: number;
  heartbeatMs: number;
  terminalAtOpen: boolean;
}

/**
 * 先订阅内存通知、再同步读取 SQLite 重放，可避免“查完历史到建立订阅之间”出现事件缺口。
 * 每条消息以 seq 作为 SSE id，浏览器重连时可通过 Last-Event-ID 精确续接。
 */
export function createRunSseStream(
  runId: string,
  eventStore: RunEventStore,
  eventHub: RunEventHub,
  options: RunSseOptions
) {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let lastSentSeq = options.afterSeq;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    unsubscribe?.();
    unsubscribe = null;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: RunEvent) => {
        if (closed || event.seq <= lastSentSeq) return;
        lastSentSeq = event.seq;
        controller.enqueue(encoder.encode(formatSseEvent(event)));
        if (terminalEventTypes.has(event.type)) {
          cleanup();
          controller.close();
        }
      };

      unsubscribe = eventHub.subscribe(runId, send);
      const replay = eventStore.listEvents(runId, {
        afterSeq: options.afterSeq,
        limit: options.replayLimit
      });
      for (const event of replay) {
        send(event);
        if (closed) return;
      }

      if (options.terminalAtOpen) {
        cleanup();
        controller.close();
        return;
      }

      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
      }, options.heartbeatMs);
    },
    cancel() {
      cleanup();
    }
  });
}

function formatSseEvent(event: RunEvent) {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

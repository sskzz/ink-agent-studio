export function createTimedAbortSignal(externalSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const duration = Math.max(1, Math.trunc(timeoutMs));
  const timeout = setTimeout(() => {
    controller.abort(new DOMException(`Timed out after ${duration} ms`, "TimeoutError"));
  }, duration);
  timeout.unref?.();

  const abortFromExternal = () => {
    controller.abort(externalSignal?.reason ?? new DOMException("Aborted", "AbortError"));
  };

  if (externalSignal?.aborted) {
    abortFromExternal();
  } else {
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  };
}

export async function abortableDelay(delayMs: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const duration = Math.max(0, Math.trunc(delayMs));
  if (duration === 0) return;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(done, duration);
    timeout.unref?.();

    function done() {
      signal?.removeEventListener("abort", aborted);
      resolve();
    }

    function aborted() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", aborted);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    }

    signal?.addEventListener("abort", aborted, { once: true });
  });
}

export function combineAbortSignals(...signals: Array<AbortSignal | undefined>) {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

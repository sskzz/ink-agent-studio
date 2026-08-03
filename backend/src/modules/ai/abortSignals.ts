/**
 * 文件职责：模型网关与各 adapter 共用的取消信号工具。
 * 边界：只处理 AbortSignal 的组合、超时与延迟，不涉及任何模型调用逻辑。
 */

/**
 * 创建"外部取消 + 超时"二合一的中止信号。
 * @param externalSignal 外部（如用户请求中断）信号，可为空
 * @param timeoutMs 超时毫秒数，至少为 1ms
 * @returns 组合后的 signal，以及用于释放定时器和监听器的 cleanup
 */
export function createTimedAbortSignal(externalSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const duration = Math.max(1, Math.trunc(timeoutMs));
  const timeout = setTimeout(() => {
    controller.abort(new DOMException(`Timed out after ${duration} ms`, "TimeoutError"));
  }, duration);
  // 非浏览器环境下 unref 让定时器不阻塞进程退出
  timeout.unref?.();

  const abortFromExternal = () => {
    controller.abort(externalSignal?.reason ?? new DOMException("Aborted", "AbortError"));
  };

  if (externalSignal?.aborted) {
    // 外部信号已中止时立即传播，避免注册监听器后事件丢失
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

/**
 * 可被取消的延时，用于重试退避等待。
 * @param delayMs 延迟毫秒数，非正数直接返回
 * @param signal 中止信号，中止时以 AbortError 拒绝
 */
export async function abortableDelay(delayMs: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const duration = Math.max(0, Math.trunc(delayMs));
  if (duration === 0) return;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(done, duration);
    timeout.unref?.();

    function done() {
      // 正常到点：移除 abort 监听后 resolve，避免重复拒绝
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

/**
 * 合并多个可选信号；全部为空返回 undefined，单个直接返回，多个用 AbortSignal.any 聚合。
 */
export function combineAbortSignals(...signals: Array<AbortSignal | undefined>) {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

const lockTails = new Map<string, Promise<void>>();

/** 单进程本地工作区的 keyed mutex，避免同一风格的索引和版本文件并发覆盖。 */
export async function withWritingStyleLock<T>(styleId: string, task: () => Promise<T>): Promise<T> {
  const previous = lockTails.get(styleId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  lockTails.set(styleId, tail);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (lockTails.get(styleId) === tail) lockTails.delete(styleId);
  }
}

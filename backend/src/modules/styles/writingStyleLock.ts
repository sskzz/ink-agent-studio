/**
 * 风格写锁（单进程 keyed mutex）。
 * 职责：按风格 id 串行化写操作，避免索引/版本/样本文件并发读写互相覆盖；
 * 边界：仅进程内生效（跨进程需外部锁）；同一风格的所有写操作（样本增删、版本重建、激活）必须走此锁。
 */

// 每个 styleId 的锁链尾部 Promise；新任务排在当前尾部之后
const lockTails = new Map<string, Promise<void>>();

/** 单进程本地工作区的 keyed mutex，避免同一风格的索引和版本文件并发覆盖。 */
export async function withWritingStyleLock<T>(styleId: string, task: () => Promise<T>): Promise<T> {
  const previous = lockTails.get(styleId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  // 新任务等待前一个任务完成；锁链末尾指向当前任务
  const tail = previous.then(() => current);
  lockTails.set(styleId, tail);
  await previous;
  try {
    return await task();
  } finally {
    release();
    // 只有自己仍是锁链尾部时才清理，防止清掉后续排队的锁
    if (lockTails.get(styleId) === tail) lockTails.delete(styleId);
  }
}

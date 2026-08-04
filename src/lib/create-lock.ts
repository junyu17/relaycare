// S3（SYNC_FIX_REVIEW）：创建类操作同步防重入锁（纯模块，可单测）。
// - acquire 同 key 在途（未释放）时拒绝，杜绝同批次连点；
// - 超时仅兜底异常路径卡死（30s 远大于正常 RPC 耗时，慢网络不误释放）；
// - release 由 promise finally 调用，正常路径锁随请求生命周期。

const locks = new Map<string, number>();

export function tryAcquireCreateLock(key: string, timeoutMs = 30_000): boolean {
  const now = Date.now();
  const heldUntil = locks.get(key) ?? 0;
  if (heldUntil > now) return false; // 在途：拒绝
  locks.set(key, now + timeoutMs);
  return true;
}

export function releaseCreateLock(key: string): void {
  locks.delete(key);
}

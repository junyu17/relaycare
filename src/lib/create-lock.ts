// S3（SYNC_FIX_REVIEW）+ X1 加固（SYNC_FIX_REVIEW_R2）：
// 防呆 API——判断语义写进函数名，调用点不可能写反（X1 曾把 tryAcquire 的布尔语义用反，
// 导致 cloud 首次点击创建静默失效；本版 isCreateBusy 名字即"忙则 return"）。
// - isCreateBusy(key)：true = 该 key 在途（忙）→ 调用点应 return；
// - beginCreate(key)：标记在途（30s 仅兜底异常路径卡死，正常由 endCreate 释放）；
// - endCreate(key)：promise finally 调用，锁随请求生命周期。

const locks = new Map<string, number>();

export function isCreateBusy(key: string): boolean {
  return (locks.get(key) ?? 0) > Date.now();
}

export function beginCreate(key: string, timeoutMs = 30_000): void {
  locks.set(key, Date.now() + timeoutMs);
}

export function endCreate(key: string): void {
  locks.delete(key);
}

// 组件卸载/ErrorBoundary 恢复时调用：清空全部在途锁，杜绝"模块级锁跨组件生命周期残留"
//（曾导致 ErrorBoundary 恢复后所有创建按钮静默无反应）。
export function resetCreateLocks(): void {
  locks.clear();
}

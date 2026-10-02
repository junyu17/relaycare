// 账号清理的共享步骤：delete-account（用户自己删号）与 purge-abandoned-anonymous（定时清理被放弃的匿名账号）共用。
//
// 0053 的 delete_account_data 在同一个数据库事务里把「协调的家庭」的 household_id 写进
// account_deletion_storage_cleanup 队列，再级联删除家庭。Storage 文件不能用 SQL 删除，必须走 Storage API，
// 所以由 Edge Function 按队列清理：先删文件，再清队列，最后才删 auth 用户。任何一步失败都保留 auth 用户和队列，
// 下次（用户重试删号，或第二天的定时任务）能从队列恢复，不会留下永久孤立的文件。
//
// delete-account/index.ts 仍保留它自己的队列读取 / 清空步骤（src/__tests__/delete-account-migration.test.ts
// 断言那几行就在 index.ts 里）；drainStorageCleanupQueue 是同样的三步，给 purge 函数用。
// _tests/delete_account_test.ts 断言两条路径对同一个队列做的 Storage 删除完全一致。

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const DOCUMENTS_BUCKET = "documents";
const PAGE_SIZE = 200;

/** 清理失败时带上失败的步骤，日志只记步骤和数据库 / Storage 的错误文本，不记用户 id。 */
export class AccountCleanupError extends Error {
  constructor(
    readonly step: "read_queue" | "storage" | "clear_queue",
    message: string
  ) {
    super(message);
    this.name = "AccountCleanupError";
  }
}

// 列出并删除 storage 桶中某个前缀下的全部对象（路径第一段 = household_id）。
export async function removeStoragePrefix(admin: SupabaseClient, householdId: string): Promise<void> {
  const prefix = `${householdId}`;
  let offset = 0;
  const paths: string[] = [];

  // 先完整分页收集，再删除。若边分页边删除并递增 offset，会因结果集收缩而跳过文件。
  for (;;) {
    const { data, error } = await admin.storage.from(DOCUMENTS_BUCKET).list(prefix, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" }
    });
    if (error) {
      throw new Error(`list storage failed for ${prefix}: ${error.message}`);
    }
    paths.push(
      ...(data ?? [])
        .filter((f: { id: string | null }) => f.id != null) // 只删文件，忽略目录占位
        .map((f: { name: string }) => `${prefix}/${f.name}`)
    );
    if (!data || data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  for (let start = 0; start < paths.length; start += PAGE_SIZE) {
    const batch = paths.slice(start, start + PAGE_SIZE);
    if (batch.length > 0) {
      const { error: rmErr } = await admin.storage.from(DOCUMENTS_BUCKET).remove(batch);
      if (rmErr) {
        throw new Error(`remove storage failed for ${prefix}: ${rmErr.message}`);
      }
    }
  }
}

/**
 * 按 0053 的队列清理一个用户的 Storage 文件，成功后清空他的队列行。
 * 调用前必须已经执行过 delete_account_data（或 0061 的 purge_anonymous_account_data）。
 */
export async function drainStorageCleanupQueue(admin: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await admin
    .from("account_deletion_storage_cleanup")
    .select("household_id")
    .eq("user_id", userId);
  if (error) throw new AccountCleanupError("read_queue", error.message);

  const householdIds = ((data ?? []) as { household_id: string }[]).map((row) => row.household_id);
  try {
    for (const householdId of householdIds) {
      await removeStoragePrefix(admin, householdId);
    }
  } catch (e) {
    throw new AccountCleanupError("storage", e instanceof Error ? e.message : String(e));
  }

  const { error: clearError } = await admin.from("account_deletion_storage_cleanup").delete().eq("user_id", userId);
  if (clearError) throw new AccountCleanupError("clear_queue", clearError.message);
  return householdIds.length;
}

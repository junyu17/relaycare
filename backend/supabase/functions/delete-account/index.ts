// Edge Function: delete-account
// 应用内删除账号 + 家庭数据（Apple Review Guideline 5.1.1）。
// 用调用者 JWT 取 uid，service role 删家庭/成员 + auth user。
//
// 部署：supabase functions deploy delete-account
// Secrets：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY（publishable）
//
// 删除语义（与 0053 delete_account_data 及隐私/条款/删除页一致）：
//   - 协调的家庭：级联删除全部家庭数据（含审计）。
//   - 其他家庭中的成员记录：匿名化 + 软删除（user_id=NULL, invite_status='removed'），
//     保留成员行以维持 tasks/documents/audit 外键引用，共享记录归属已删除成员占位符。
//   - 协调家庭的 storage 文件（documents/{household_id}/...）通过 0053 的
//     account_deletion_storage_cleanup 队列可靠清理；失败可由同一用户重试。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
const SUPA_URL = Deno.env.get("SUPABASE_URL");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json"
    }
  });
}

// 列出并删除 storage 桶中某个前缀下的全部对象（路径第一段 = household_id）。
async function removeStoragePrefix(admin: ReturnType<typeof createClient>, householdId: string): Promise<void> {
  const BUCKET = "documents";
  const prefix = `${householdId}`;
  let offset = 0;
  const LIMIT = 200;
  const paths: string[] = [];

  // 先完整分页收集，再删除。若边分页边删除并递增 offset，会因结果集收缩而跳过文件。
  for (;;) {
    const { data, error } = await admin.storage.from(BUCKET).list(prefix, {
      limit: LIMIT,
      offset,
      sortBy: { column: "name", order: "asc" }
    });
    if (error) {
      throw new Error(`list storage failed for ${prefix}: ${error.message}`);
    }
    paths.push(
      ...(data ?? [])
        .filter((f) => f.id != null) // 只删文件，忽略目录占位
        .map((f) => `${prefix}/${f.name}`)
    );
    if (!data || data.length < LIMIT) break;
    offset += LIMIT;
  }

  for (let start = 0; start < paths.length; start += LIMIT) {
    const batch = paths.slice(start, start + LIMIT);
    if (batch.length > 0) {
      const { error: rmErr } = await admin.storage.from(BUCKET).remove(batch);
      if (rmErr) {
        throw new Error(`remove storage failed for ${prefix}: ${rmErr.message}`);
      }
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200 });
  if (!SERVICE_ROLE || !SUPA_URL || !ANON_KEY) return json({ ok: false, error: "Server misconfigured" }, 500);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, error: "Not authenticated" }, 401);

    // 用调用者 token 取 uid。
    const userClient = createClient(SUPA_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: ud, error: ue } = await userClient.auth.getUser();
    if (ue || !ud.user) return json({ ok: false, error: "Invalid session" }, 401);
    const uid = ud.user.id;

    const admin = createClient(SUPA_URL, SERVICE_ROLE);

    // 删家庭/成员数据，再删 auth 账号。
    const { error: de } = await admin.rpc("delete_account_data", { p_user_id: uid });
    if (de) {
      // 细节只进服务端日志；客户端仅收到通用消息。
      console.error("delete-account: delete_account_data failed", de.message);
      return json({ ok: false, error: "Unable to delete account data. Please try again later." }, 500);
    }

    // 0053 在同一数据库事务中保留了待清理 household_id；中途失败时保留 auth 用户和
    // 队列，用户可安全重试，不会永久遗失 Storage 清理目标。
    const { data: pendingCleanup, error: cleanupReadError } = await admin
      .from("account_deletion_storage_cleanup")
      .select("household_id")
      .eq("user_id", uid);
    if (cleanupReadError) {
      console.error("delete-account: read storage cleanup queue failed", cleanupReadError.message);
      return json({ ok: false, error: "Unable to delete account data. Please try again later." }, 500);
    }

    try {
      for (const row of pendingCleanup ?? []) {
        await removeStoragePrefix(admin, (row as { household_id: string }).household_id);
      }
    } catch (error) {
      console.error("delete-account: storage cleanup failed", error instanceof Error ? error.message : String(error));
      return json({ ok: false, error: "Unable to delete account data. Please try again later." }, 500);
    }

    const { error: cleanupDeleteError } = await admin
      .from("account_deletion_storage_cleanup")
      .delete()
      .eq("user_id", uid);
    if (cleanupDeleteError) {
      console.error("delete-account: clear storage cleanup queue failed", cleanupDeleteError.message);
      return json({ ok: false, error: "Unable to delete account data. Please try again later." }, 500);
    }

    const { error: ae } = await admin.auth.admin.deleteUser(uid);
    if (ae) {
      console.error("delete-account: deleteUser failed", ae.message);
      return json({ ok: false, error: "Unable to delete account. Please try again later." }, 500);
    }

    return json({ ok: true }, 200);
  } catch (e) {
    console.error("delete-account: unexpected failure", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: "Unable to delete account. Please try again later." }, 500);
  }
});

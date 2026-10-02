// Edge Function: purge-abandoned-anonymous
// 自动删除被放弃的未绑定匿名账号（方案 B 决策 5A，规则写进隐私政策）：
//   empty：没有成员关系、名下没有订阅，30 天没有任何会话活动；
//   solo ：名下没有订阅，所在的每个家庭除自己外没有 active / pending 成员，180 天没有任何会话活动。
// 候选与锁内复查都在 0061（anonymous_retention_candidates / purge_anonymous_account_data），
// 所以家人还在用的家庭、已绑定 Apple 或邮箱密码的账号、付款人永远不会被这里删除。
//
// 每次最多处理 50 个账号；对每个账号依次执行：
//   purge_anonymous_account_data（锁内复查 + 0053 delete_account_data，Storage 目标进清理队列）
//   → Storage 清理（_shared/account-cleanup.ts，与 delete-account 共用）
//   → auth.admin.deleteUser。
// 单个账号失败不影响后面的账号；失败的账号数据已删或未删都会在下一次运行时重新进入候选（empty），
// 并从 0053 的队列恢复 Storage 清理。
//
// 调用方：pg_cron（0062）每天一次通过 pg_net 调用，请求头 x-cron-secret = Vault 里的 CRON_SECRET。
// 单用户模式（处理邮件删号申请，Billy 每次单独同意后才调用）：请求体 {"userId": "<uuid>"}，
// 条件不变，只把不活跃门槛改成 14 天。
// 日志和响应只有数量，不含用户 id。
//
// 部署：supabase functions deploy purge-abandoned-anonymous --no-verify-jwt（pg_net 不带用户 JWT，靠 CRON_SECRET）
// Secrets：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（自动注入）、CRON_SECRET（用 --env-file 读入，不进仓库）。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AccountCleanupError, drainStorageCleanupQueue } from "../_shared/account-cleanup.ts";
import { constantTimeEqual } from "../_shared/apple-siwa.ts";

const BATCH_LIMIT = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const SUPA_URL = Deno.env.get("SUPABASE_URL");
  const CRON_SECRET = Deno.env.get("CRON_SECRET");
  if (!SERVICE_ROLE || !SUPA_URL || !CRON_SECRET) return json({ ok: false, error: "Server misconfigured" }, 500);

  const provided = req.headers.get("x-cron-secret") ?? "";
  if (!provided || !(await constantTimeEqual(provided, CRON_SECRET))) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  let singleUserId: string | null = null;
  try {
    const text = await req.text();
    if (text.trim()) {
      const body = JSON.parse(text) as { userId?: unknown };
      if (body?.userId != null) {
        if (typeof body.userId !== "string" || !UUID_RE.test(body.userId)) {
          return json({ ok: false, error: "userId must be a uuid" }, 400);
        }
        singleUserId = body.userId;
      }
    }
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const admin = createClient(SUPA_URL, SERVICE_ROLE);
  const { data: candidates, error: ce } = await admin.rpc("anonymous_retention_candidates", {
    p_limit: BATCH_LIMIT,
    p_user_id: singleUserId
  });
  if (ce) {
    console.error("purge-abandoned-anonymous: candidates failed", ce.message);
    return json({ ok: false, error: "Unable to list candidates" }, 500);
  }

  const rows = (candidates ?? []) as { user_id: string; kind: string }[];
  const purged: Record<string, number> = { empty: 0, solo: 0 };
  let skipped = 0;
  const failed: Record<string, number> = {};

  for (const row of rows) {
    let step = "purge_anonymous_account_data";
    try {
      // 锁内复查：列出之后有人加入、绑定了 Apple、开始付费或重新活跃，就返回 NULL、什么都不删。
      const { data: kind, error: pe } = await admin.rpc("purge_anonymous_account_data", {
        p_uid: row.user_id,
        p_single_user: singleUserId !== null
      });
      if (pe) throw new Error(pe.message);
      if (kind !== "empty" && kind !== "solo") {
        skipped += 1;
        continue;
      }

      step = "storage";
      await drainStorageCleanupQueue(admin, row.user_id);

      step = "admin.deleteUser";
      const { error: ae } = await admin.auth.admin.deleteUser(row.user_id);
      if (ae) throw new Error(ae.message);
      purged[kind] += 1;
    } catch (e) {
      const failedStep = e instanceof AccountCleanupError ? e.step : step;
      failed[failedStep] = (failed[failedStep] ?? 0) + 1;
      // 只记失败的步骤（Storage 的报错文本里有 household_id，这里不记）。
      console.error("purge-abandoned-anonymous: account failed at", failedStep);
    }
  }

  const failedTotal = Object.values(failed).reduce((sum, n) => sum + n, 0);
  const summary = { candidates: rows.length, purged, skipped, failed: failedTotal, failedSteps: failed };
  console.log("purge-abandoned-anonymous:", JSON.stringify({ mode: singleUserId ? "single" : "daily", ...summary }));
  return json({ ok: failedTotal === 0, ...summary }, 200);
});

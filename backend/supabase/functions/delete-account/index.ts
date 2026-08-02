// Edge Function: delete-account
// 应用内删除账号 + 家庭数据（Apple Review Guideline 5.1.1）。
// 用调用者 JWT 取 uid，service role 删家庭/成员 + auth user。
//
// 部署：supabase functions deploy delete-account
// Secrets：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY（publishable）

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

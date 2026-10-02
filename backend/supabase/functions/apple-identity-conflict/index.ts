// Edge Function: apple-identity-conflict
// 匿名用户绑定 Apple 时，linkIdentity 返回 identity_already_exists（这个 Apple ID 已经属于 TaskKin 账号 X）。
// 客户端把 Apple 的 identityToken 和原始 nonce 交过来，这里先证明调用者确实持有这个 Apple ID，
// 再决定怎么处理。有数据的账号任何情况下都不会被自动删除（方案 B 评审 blocker 1）。
//
// 请求：POST {idToken, rawNonce}，Authorization = 当前匿名会话（U）的 JWT。
// 返回：{ok: true, result}，result 为：
//   no_conflict     这个 Apple ID 没有账号，或就是 U 自己 —— 客户端重试 linkIdentity。
//   freed           X 是空账号（无成员关系、无订阅、只有 Apple 身份、没有密码），已在锁内删除 ——
//                   客户端用同一个 token 重新 linkIdentity，本机家庭原样保留。
//   caller_empty    X 有数据、U 是空的 —— 这里不删任何账号；客户端先 signInWithIdToken 登录 X，
//                   成功之后才用 U 的 token 调 delete-account 删 U（失败也无妨，0061 会在 30 天后清理）。
//   both_have_data  两边都有数据 —— 什么都不删，也不切换。
// 错误：401 未登录 / Apple 凭证无效（签名、iss、aud、exp、nonce）；403 调用者不是匿名用户；
//       400 缺少参数；500 服务端错误。
//
// 日志只记结果类型，不记 token、nonce、Apple sub 或用户 id。
//
// 部署：supabase functions deploy apple-identity-conflict --no-verify-jwt（和 delete-account 一样在函数里自行校验）
// Secrets：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY（自动注入）、APPLE_BUNDLE_ID（默认 cd.cc.relaycare）。
// 依赖 0058 的 service_role 函数 apple_identity_owner / delete_auth_user_if_empty / account_has_data。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AppleTokenError, verifyAppleIdToken } from "../_shared/apple-siwa.ts";

type ConflictResult = "no_conflict" | "freed" | "caller_empty" | "both_have_data";

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

function done(result: ConflictResult): Response {
  console.log("apple-identity-conflict:", result);
  return json({ ok: true, result }, 200);
}

function serverError(step: string, detail?: string): Response {
  // detail 是数据库 / GoTrue 的错误文本，不含 token 或 sub。
  console.error("apple-identity-conflict: failed", step, detail ?? "");
  return json({ ok: false, error: "Unable to check this Apple ID right now. Please try again later." }, 500);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200 });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const SUPA_URL = Deno.env.get("SUPABASE_URL");
  if (!SERVICE_ROLE || !SUPA_URL || !ANON_KEY) return json({ ok: false, error: "Server misconfigured" }, 500);

  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, error: "Not authenticated" }, 401);

    // ① 调用者必须是匿名用户 U。
    const userClient = createClient(SUPA_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: ud, error: ue } = await userClient.auth.getUser();
    if (ue || !ud.user) return json({ ok: false, error: "Invalid session" }, 401);
    if (ud.user.is_anonymous !== true) {
      return json({ ok: false, error: "Only a guest session can resolve an Apple sign-in conflict" }, 403);
    }
    const callerId = ud.user.id;

    let body: { idToken?: unknown; rawNonce?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Missing Apple credential" }, 400);
    }
    const idToken = typeof body?.idToken === "string" ? body.idToken : "";
    const rawNonce = typeof body?.rawNonce === "string" ? body.rawNonce : "";
    if (!idToken || !rawNonce) return json({ ok: false, error: "Missing Apple credential" }, 400);

    // ② 校验 Apple id_token：签名（Apple JWKS）、iss、aud、exp、nonce。
    let appleSub: string;
    try {
      ({ sub: appleSub } = await verifyAppleIdToken(idToken, rawNonce));
    } catch (e) {
      console.warn("apple-identity-conflict: rejected credential", e instanceof AppleTokenError ? e.message : "error");
      return json({ ok: false, error: "Invalid Apple credential" }, 401);
    }

    const admin = createClient(SUPA_URL, SERVICE_ROLE);

    // ③ X = 这个 Apple ID 现在属于谁。
    const { data: ownerId, error: oe } = await admin.rpc("apple_identity_owner", { p_sub: appleSub });
    if (oe) return serverError("apple_identity_owner", oe.message);
    if (!ownerId || ownerId === callerId) return done("no_conflict");

    // ④ X 是空账号：锁住 auth.users 行复查后删除。
    const { data: deleted, error: de } = await admin.rpc("delete_auth_user_if_empty", { p_uid: ownerId });
    if (de) return serverError("delete_auth_user_if_empty", de.message);
    if (deleted === true) return done("freed");
    if (deleted === null) {
      // 条件已满足，但数据库角色没有 auth.users 的 DELETE 权限：改用 Admin API 删除
      //（复查与删除之间有毫秒级窗口，见 0058 头注释与方案 risks）。
      const { error: ae } = await admin.auth.admin.deleteUser(ownerId);
      if (ae) return serverError("admin.deleteUser", ae.message);
      return done("freed");
    }

    // ⑤ X 有数据：看 U 是不是空的。这里不删 U —— 客户端登录 X 成功之后才删。
    const { data: callerHasData, error: he } = await admin.rpc("account_has_data", { p_uid: callerId });
    if (he) return serverError("account_has_data", he.message);
    return done(callerHasData === false ? "caller_empty" : "both_have_data");
  } catch (e) {
    return serverError("unexpected", e instanceof Error ? e.name : "error");
  }
});

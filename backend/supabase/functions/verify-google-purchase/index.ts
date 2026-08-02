// Edge Function: verify-google-purchase
// Android（Google Play Billing）订阅验证：用 Play Developer API 校验 purchaseToken，
// 确认订阅 active 且绑定当前用户（obfuscatedAccountId），写 entitlement（复用 subscriptions 表）。
//
// 部署：supabase functions deploy verify-google-purchase --no-verify-jwt
// Secrets：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（自动注入）/ SUPABASE_ANON_KEY /
//          GOOGLE_SERVICE_ACCOUNT_JSON（Play Console 服务账号 JSON，含 private_key/client_email）
//          GOOGLE_PLAY_PACKAGE（默认 cd.cc.taskkincare）

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { importPKCS8, SignJWT } from "https://esm.sh/jose@5.10.0";

const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
const SUPA_URL = Deno.env.get("SUPABASE_URL");
const PACKAGE = Deno.env.get("GOOGLE_PLAY_PACKAGE") ?? "cd.cc.taskkincare";
const GOOGLE_SA_JSON = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");

const SKU_TO_PLAN: Record<string, "monthly" | "yearly"> = {
  "TaskKin.care.pro.yearly": "yearly",
  "TaskKin.care.pro.mon": "monthly"
};

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

function fail(code: string, message: string, status: number, extra?: Record<string, unknown>): Response {
  console.error("verify-google-purchase failed", JSON.stringify({ code, status, ...extra }));
  return json({ ok: false, code, error: message }, status);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

// Google OAuth access token 缓存（1 小时有效，缓存至过期前 5 分钟）
let googleTokenCache: { token: string; expiresAt: number } | null = null;

async function getGoogleAccessToken(): Promise<string> {
  if (googleTokenCache && googleTokenCache.expiresAt > Date.now() + 5 * 60 * 1000) {
    return googleTokenCache.token;
  }
  const sa = JSON.parse(GOOGLE_SA_JSON ?? "{}");
  if (!sa.private_key || !sa.client_email) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is invalid");
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(sa.private_key, "RS256");
  const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/androidpublisher" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google OAuth failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Google OAuth returned no access_token");
  googleTokenCache = { token: data.access_token, expiresAt: Date.now() + 3600 * 1000 };
  return data.access_token;
}

// Play Developer API 订阅验证
async function verifyPlaySubscription(
  accessToken: string,
  productId: string,
  purchaseToken: string
): Promise<{
  subscriptionState: number;
  expiryTimeMillis?: string;
  startTimeMillis?: string;
  obfuscatedExternalAccountId?: string;
}> {
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/purchases/subscriptions/${productId}/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 404 || res.status === 400) {
      // 无效/未知 token：按业务错误返回（catch 转 400）
      const err = new Error("Purchase token not found or invalid") as Error & { playStatus?: number };
      err.playStatus = res.status;
      throw err;
    }
    throw new Error(`Play API failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200 });
  if (!SERVICE_ROLE || !SUPA_URL || !ANON_KEY || !GOOGLE_SA_JSON) {
    return fail("SERVER_MISCONFIGURED", "Server misconfigured", 500, {
      hasServiceRole: Boolean(SERVICE_ROLE),
      hasGoogleSa: Boolean(GOOGLE_SA_JSON)
    });
  }

  try {
    const { productId, purchaseToken, householdId } = await req.json();
    if (!productId || !purchaseToken || !householdId) {
      return fail("MISSING_REQUIRED_FIELDS", "Missing required fields", 400);
    }
    const plan = SKU_TO_PLAN[productId];
    if (!plan) return fail("UNKNOWN_PRODUCT_ID", "Unknown product id", 400, { productId });

    // 调用者身份
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return fail("NOT_AUTHENTICATED", "Not authenticated", 401);
    const userClient = createClient(SUPA_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return fail("INVALID_SESSION", "Invalid session", 401);

    // Play Developer API 验证
    const accessToken = await getGoogleAccessToken();
    const sub = await verifyPlaySubscription(accessToken, productId, purchaseToken);

    // 订阅必须 active（1）且未过期
    if (sub.subscriptionState !== 1) {
      return fail("SUBSCRIPTION_NOT_ACTIVE", "This subscription is not active", 400, { state: sub.subscriptionState });
    }
    const expiresMs = Number(sub.expiryTimeMillis);
    if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
      return fail("SUBSCRIPTION_EXPIRED", "This subscription has expired", 400);
    }
    // 交易必须绑定当前用户：客户端购买时传 obfuscatedAccountId = 'u_' + auth.uid()
    // （Play Billing 要求 [a-zA-Z0-9_] 且不以数字开头，故加 'u_' 前缀）。
    // 客户端传 u_ + uid(去连字符)；Play 正则要求 [a-zA-Z0-9_]*（含连字符 UUID 会被拒）。
    const expectedObfuscatedId = `u_${userData.user.id.replace(/-/g, "")}`;
    if (!sub.obfuscatedExternalAccountId || sub.obfuscatedExternalAccountId !== expectedObfuscatedId) {
      return fail(
        "ACCOUNT_TOKEN_MISMATCH",
        "This purchase is not bound to your account. Please restore purchases.",
        403
      );
    }

    // coordinator 校验 + 登记
    const admin = createClient(SUPA_URL, SERVICE_ROLE);
    const { data: member, error: memberError } = await admin
      .from("members")
      .select("id, role")
      .eq("household_id", householdId)
      .eq("user_id", userData.user.id)
      .eq("invite_status", "active")
      .maybeSingle();
    if (memberError) {
      return fail("MEMBERSHIP_LOOKUP_FAILED", "Unable to verify household membership", 500, {
        dbError: memberError.message
      });
    }
    if (!member) return fail("NOT_HOUSEHOLD_MEMBER", "You are not an active member of this household", 403);
    if (member.role !== "coordinator") {
      return fail("COORDINATOR_REQUIRED", "Only a household coordinator can purchase", 403);
    }

    const plusUntil = new Date(expiresMs).toISOString();
    const originalTxId = `g:${purchaseToken}`;
    const { error: upErr } = await admin.rpc("register_google_subscription", {
      p_household_id: householdId,
      p_original_transaction_id: originalTxId,
      p_plan: plan,
      p_expires_at: plusUntil,
      p_owner_member_id: member.id,
      p_owner_user_id: userData.user.id
    });
    if (upErr) {
      return fail(
        "SUBSCRIPTION_REGISTER_FAILED",
        "Unable to register subscription. Please try again or restore purchases.",
        500,
        {
          dbError: upErr.message,
          plan,
          originalTransactionId: `g:<redacted>`
        }
      );
    }

    console.log("verify-google-purchase succeeded", JSON.stringify({ plan, householdId }));
    return json({ ok: true, plan, plusUntil }, 200);
  } catch (e) {
    console.error("verify-google-purchase unexpected failure", errorMessage(e));
    const playStatus = (e as { playStatus?: number }).playStatus;
    if (playStatus === 404 || playStatus === 400) {
      return fail("INVALID_PURCHASE_TOKEN", "Unable to verify purchase. Please try again or restore purchases.", 400);
    }
    return fail("VERIFICATION_FAILED", "Unable to verify purchase. Please try again or restore purchases.", 500);
  }
});

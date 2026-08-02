// Edge Function: play-rtdn
// Google Play 实时开发者通知（RTDN，Pub/Sub push webhook）：
// 订阅续费/取消/过期/退款时，用 Play V2 接口查询最新状态并同步 entitlement
// （active → 延长 plusUntil；canceled/expired → 回退 free）。
//
// 部署：supabase functions deploy play-rtdn --no-verify-jwt
// Secrets：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（自动注入）/
//          GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_PLAY_PACKAGE /
//          RTDN_VERIFICATION_TOKEN（可选：Pub/Sub push 自定义 Authorization 校验）
// Play Console 配置：Monetize → Subscriptions → 通知 → 关联 Pub/Sub topic。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { importPKCS8, SignJWT } from "https://esm.sh/jose@5.10.0";

const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPA_URL = Deno.env.get("SUPABASE_URL");
const PACKAGE = Deno.env.get("GOOGLE_PLAY_PACKAGE") ?? "cd.cc.taskkincare";
const GOOGLE_SA_JSON = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
const RTDN_TOKEN = Deno.env.get("RTDN_VERIFICATION_TOKEN");

const SKU_TO_PLAN: Record<string, "monthly" | "yearly"> = {
  "taskkin.care.pro.yearly": "yearly",
  "taskkin.care.pro.monthly": "monthly"
};

let googleTokenCache: { token: string; expiresAt: number } | null = null;

async function getGoogleAccessToken(): Promise<string> {
  if (googleTokenCache && googleTokenCache.expiresAt > Date.now() + 5 * 60 * 1000) return googleTokenCache.token;
  const sa = JSON.parse(GOOGLE_SA_JSON ?? "{}");
  if (!sa.private_key || !sa.client_email) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON invalid");
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
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt })
  });
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Google OAuth failed");
  googleTokenCache = { token: data.access_token, expiresAt: Date.now() + 3600 * 1000 };
  return data.access_token;
}

async function queryV2(
  accessToken: string,
  productId: string,
  purchaseToken: string
): Promise<{
  subscriptionState?: string;
  lineItems?: { expiryTime?: string }[];
}> {
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    console.error("play-rtdn: V2 query failed", res.status, await res.text());
    return null; // 查询失败：调用方保守跳过，不做降级
  }
  return await res.json();
}

// 按 purchaseToken 定位订阅记录并同步权益。
// 状态：SUBSCRIPTION_STATE_ACTIVE → plusUntil=expiryTime；否则回退 free。
async function syncEntitlement(
  admin: ReturnType<typeof createClient>,
  purchaseToken: string,
  productId: string
): Promise<void> {
  const originalTxId = `g:${purchaseToken}`;
  const { data: subs, error: subErr } = await admin
    .from("subscriptions")
    .select("id, household_id, owner_user_id, plan")
    .eq("original_transaction_id", originalTxId);
  if (subErr || !subs?.length) {
    console.warn("play-rtdn: no subscription record for", originalTxId.slice(0, 20));
    return;
  }
  const accessToken = await getGoogleAccessToken();
  const v2 = await queryV2(accessToken, productId, purchaseToken);
  if (!v2) {
    // 查询失败：保守跳过（不降级有效订阅、不误改状态）。
    console.warn("play-rtdn: V2 query unavailable, skip sync for", originalTxId.slice(0, 20));
    return;
  }

  // 以 lineItems[0].expiryTime 为准：到期时间在未来则保留权益（即使状态为
  // CANCELED/PAUSED/IN_GRACE 等——用户取消续订或宽限期，周期内权益仍应有效）；
  // 仅当明确过期/撤销时才回退 free。
  const expiryStr = v2.lineItems?.[0]?.expiryTime;
  const expiresMs = expiryStr ? Date.parse(expiryStr) : NaN;
  const isActive =
    v2.subscriptionState === "SUBSCRIPTION_STATE_ACTIVE" || (Number.isFinite(expiresMs) && expiresMs > Date.now());

  for (const sub of subs) {
    if (isActive) {
      if (!Number.isFinite(expiresMs)) continue;
      await admin
        .rpc("sync_subscription_state", {
          p_original_transaction_id: originalTxId,
          p_status: "active",
          p_plan: sub.plan, // 保留已购 plan，不覆盖
          p_expires_at: new Date(expiresMs).toISOString()
        })
        .then((r) => {
          if (r.error) console.error("play-rtdn: sync active failed", r.error.message);
        });
    } else {
      await admin
        .rpc("sync_subscription_state", {
          p_original_transaction_id: originalTxId,
          p_status: v2.subscriptionState === "SUBSCRIPTION_STATE_EXPIRED" ? "expired" : "revoked",
          p_plan: sub.plan, // 保留已购 plan（同步状态时不改写 plan）
          p_expires_at: new Date().toISOString()
        })
        .then((r) => {
          if (r.error) console.error("play-rtdn: sync revoke failed", r.error.message);
        });
    }
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  // 强制自定义验证 token（Pub/Sub push 订阅的 Authorization 头）——未配置时拒绝，
  // 防止无鉴权 POST 触发 V2 配额消耗与状态同步。
  if (!RTDN_TOKEN) {
    console.error("play-rtdn: RTDN_VERIFICATION_TOKEN not configured");
    return new Response("ok", { status: 200 }); // 不回 401 避免 Pub/Sub 无限重试，但拒绝处理
  }
  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${RTDN_TOKEN}`) return new Response("unauthorized", { status: 401 });
  if (!SERVICE_ROLE || !SUPA_URL || !GOOGLE_SA_JSON) {
    console.error("play-rtdn: server misconfigured");
    return new Response("ok", { status: 200 }); // 避免 Pub/Sub 无限重试
  }
  try {
    const body = await req.json();
    const msg = body?.message;
    const data = msg?.data ? JSON.parse(atob(msg.data)) : null;
    if (!data?.subscriptionNotification) {
      // 非订阅通知（test notification 等）直接确认
      return new Response("ok", { status: 200 });
    }
    const { purchaseToken, subscriptionId } = data.subscriptionNotification;
    console.log(
      "play-rtdn",
      JSON.stringify({
        type: data.subscriptionNotification.notificationType,
        purchaseToken: `${purchaseToken.slice(0, 12)}...`,
        subscriptionId
      })
    );
    const admin = createClient(SUPA_URL, SERVICE_ROLE);
    await syncEntitlement(admin, purchaseToken, subscriptionId);
    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error("play-rtdn: handler error", e instanceof Error ? e.message : String(e));
    return new Response("ok", { status: 200 });
  }
});

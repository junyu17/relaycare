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
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from "https://esm.sh/jose@5.10.0";

const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPA_URL = Deno.env.get("SUPABASE_URL");
const PACKAGE = Deno.env.get("GOOGLE_PLAY_PACKAGE") ?? "cd.cc.taskkincare";
const GOOGLE_SA_JSON = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
// Pub/Sub push 鉴权：Authorization 是 Google 签发的 OIDC JWT（iss=accounts.google.com，
// audience=push 订阅 URL）。配置 RTDN_EXPECTED_AUDIENCE（函数 URL）后启用 OIDC 验证；
// RTDN_EXPECTED_EMAIL 可选（Pub/Sub 服务账号邮箱）。
const RTDN_EXPECTED_AUDIENCE = Deno.env.get("RTDN_EXPECTED_AUDIENCE");
const RTDN_EXPECTED_EMAIL = Deno.env.get("RTDN_EXPECTED_EMAIL");
const googleJWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

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
  if (!res.ok) {
    const bodyText = await res.text();
    throw new Error(`Google OAuth failed: ${res.status} ${bodyText.slice(0, 200)}`);
  }
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
    const bodyText = await res.text();
    console.error("play-rtdn: V2 query failed", res.status, bodyText);
    // 抛异常 → 外层 catch 返回 500，Pub/Sub 重试（幂等 RPC，重试无害）；
    // 避免退款（REVOKED）等关键事件因临时失败被去重吞掉、权益回收延迟。
    throw new Error(`Play V2 query failed: ${res.status}`);
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

  // 以 lineItems[0].expiryTime 为准：到期时间在未来则保留权益（即使状态为
  // CANCELED/PAUSED/IN_GRACE 等——用户取消续订或宽限期，周期内权益仍应有效）；
  // 仅当明确过期/撤销时才回退 free。
  const expiryStr = v2.lineItems?.[0]?.expiryTime;
  const expiresMs = expiryStr ? Date.parse(expiryStr) : NaN;
  // REVOKED（退款）强制回退 free——即使 Google 未同步修改 expiryTime，也立即回收权益。
  const isRevoked = v2.subscriptionState === "SUBSCRIPTION_STATE_REVOKED";
  const isActive =
    !isRevoked &&
    (v2.subscriptionState === "SUBSCRIPTION_STATE_ACTIVE" || (Number.isFinite(expiresMs) && expiresMs > Date.now()));

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
      // 状态语义对齐：EXPIRED=到期、CANCELED=用户取消续订、REVOKED=退款；其余非活跃归 revoked。
      const finalStatus =
        v2.subscriptionState === "SUBSCRIPTION_STATE_EXPIRED"
          ? "expired"
          : v2.subscriptionState === "SUBSCRIPTION_STATE_CANCELED"
            ? "canceled"
            : "revoked";
      await admin
        .rpc("sync_subscription_state", {
          p_original_transaction_id: originalTxId,
          p_status: finalStatus,
          p_plan: sub.plan, // 保留已购 plan（同步状态时不改写 plan）
          p_expires_at: new Date().toISOString()
        })
        .then((r) => {
          if (r.error) console.error("play-rtdn: sync revoke failed", r.error.message);
        });
    }
  }
}

// 已处理 messageId 去重窗口（内存，1 小时；sync 幂等，重复处理无害）
const processedMessages = new Map<string, number>();
const RTDN_DEDUP_WINDOW_MS = 60 * 60 * 1000;

async function verifyRtdnAuth(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  if (!RTDN_EXPECTED_AUDIENCE) {
    console.error("play-rtdn: RTDN_EXPECTED_AUDIENCE not configured, cannot verify OIDC");
    return false;
  }
  try {
    const { payload } = await jwtVerify(token, googleJWKS, {
      // Google OIDC issuer：标准为 https://accounts.google.com；兼容无前缀形式。
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: RTDN_EXPECTED_AUDIENCE
    });
    if (RTDN_EXPECTED_EMAIL && payload.email !== RTDN_EXPECTED_EMAIL) {
      console.warn("play-rtdn: OIDC email mismatch", String(payload.email ?? ""));
      return false;
    }
    return true;
  } catch (e) {
    console.warn("play-rtdn: OIDC verification failed", e instanceof Error ? e.message : String(e));
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  if (!(await verifyRtdnAuth(req))) {
    // 未通过 OIDC 验证：返回 401（不确认），Pub/Sub 会重试；同时防无鉴权滥用。
    return new Response("unauthorized", { status: 401 });
  }
  if (!SERVICE_ROLE || !SUPA_URL || !GOOGLE_SA_JSON) {
    console.error("play-rtdn: server misconfigured");
    return new Response("ok", { status: 200 }); // 配置缺失属部署问题，不触发无限重试
  }
  try {
    const body = await req.json();
    const msg = body?.message;
    const messageId = msg?.messageId ? String(msg.messageId) : "";
    if (messageId) {
      const seenAt = processedMessages.get(messageId);
      if (seenAt && Date.now() - seenAt < RTDN_DEDUP_WINDOW_MS) {
        return new Response("ok", { status: 200 }); // 去重：已成功处理过
      }
      // 注意：仅在成功确认（下方 return 200）后标记，避免 500 重试被去重吞掉。
    }
    const data = msg?.data ? JSON.parse(atob(msg.data)) : null;
    if (!data?.subscriptionNotification) {
      return new Response("ok", { status: 200 }); // 非订阅通知（test notification 等）直接确认
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
    if (messageId) processedMessages.set(messageId, Date.now()); // 成功后才标记去重
    return new Response("ok", { status: 200 });
  } catch (e) {
    // 临时失败（OAuth/网络/配额）：500 让 Pub/Sub 重试；业务失败（无记录）在 syncEntitlement 内返回。
    console.error("play-rtdn: handler error", e instanceof Error ? e.message : String(e));
    return new Response("temporary failure", { status: 500 });
  }
});

// Edge Function: apple-server-notifications
// 接收 App Store Server Notifications V2，按续订/退款/撤销/到期同步家庭 entitlement。
//
// 配置：App Store Connect -> App -> App Store Server Notifications V2 -> 生产/Sandbox URL
//   指向本函数：https://<project>.functions.supabase.co/apple-server-notifications
// Secrets：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（自动注入）/ APPLE_BUNDLE_ID。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { acceptedEnvironmentsFromEnv, assertAppleBundleAndEnvironment, verifyAppleJws } from "../_shared/apple-jws.ts";

// 环境策略（与 verify-apple-receipt 一致）：生产默认仅 Production；TestFlight 用 ALLOW_SANDBOX_PURCHASES=true 追加。
const ACCEPTED_ENVIRONMENTS = acceptedEnvironmentsFromEnv(
  Deno.env.get("APPLE_ACCEPTED_ENVIRONMENTS"),
  Deno.env.get("ALLOW_SANDBOX_PURCHASES")
);

const BUNDLE_ID = Deno.env.get("APPLE_BUNDLE_ID") ?? "cd.cc.relaycare";
const APP_APPLE_ID = Number(Deno.env.get("APPLE_APPLE_ID") ?? Deno.env.get("APPLE_APP_APPLE_ID") ?? "6794837934");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPA_URL = Deno.env.get("SUPABASE_URL");

const SKU_TO_PLAN: Record<string, "monthly" | "yearly"> = {
  "TaskKin.care.pro.yearly": "yearly",
  "TaskKin.care.pro.mon": "monthly"
};

async function verifyNotification(signedPayload: string) {
  const notification = await verifyAppleJws(signedPayload);
  assertNotificationData(notification);
  return notification;
}

// 通知类型 -> 订阅状态。DID_CHANGE_RENEWAL_PREF（关闭自动续订）不立即取消，到期前仍有效。
function statusFor(type: string): "active" | "expired" | "revoked" | "canceled" {
  if (type === "CANCEL" || type === "REFUND" || type === "REVOKE") return "revoked";
  if (type === "EXPIRED" || type === "GRACE_PERIOD_EXPIRED") return "expired";
  return "active"; // SUBSCRIBED, DID_RENEW, RECOVERY, PRICE_INCREASE, DID_CHANGE_RENEWAL_PREF, ...
}

function assertNotificationData(notification: Record<string, unknown>): void {
  const data = notification.data as Record<string, unknown> | undefined;
  if (!data) return;
  if (data.bundleId !== BUNDLE_ID) {
    throw new Error(`Invalid Apple notification bundleId: ${String(data.bundleId)}`);
  }
  if (!ACCEPTED_ENVIRONMENTS.has(String(data.environment))) {
    throw new Error(`Invalid Apple notification environment: ${String(data.environment)}`);
  }
  const appAppleId = Number(data.appAppleId);
  if (data.environment === "Production" && Number.isFinite(appAppleId) && appAppleId !== APP_APPLE_ID) {
    throw new Error(`Invalid Apple notification appAppleId: ${String(data.appAppleId)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  if (!SERVICE_ROLE || !SUPA_URL) return new Response("misconfigured", { status: 500 });

  try {
    const { signedPayload } = await req.json();
    if (!signedPayload) return new Response("ok", { status: 200 });

    const notification = await verifyNotification(signedPayload);
    const type = notification.notificationType ?? "";

    // 解码内嵌的签名交易，取 productId / 到期 / originalTransactionId。
    const signedTx = notification.data?.signedTransactionInfo;
    if (!signedTx) return new Response("ok", { status: 200 }); // TEST 通知等无交易信息。
    const tx = await verifyAppleJws(signedTx);
    assertAppleBundleAndEnvironment(tx, BUNDLE_ID, ACCEPTED_ENVIRONMENTS);

    const productId = tx.productId;
    if (!productId) return new Response("ok", { status: 200 });
    const plan = SKU_TO_PLAN[productId];
    if (!plan) return new Response("ok", { status: 200 }); // 非本产品，忽略。

    const status = statusFor(type);
    const expiresAt = tx.expiresDate ? new Date(tx.expiresDate).toISOString() : null;
    const originalTxId = tx.originalTransactionId ?? tx.transactionId;
    if (!originalTxId) return new Response("ok", { status: 200 });

    const admin = createClient(SUPA_URL, SERVICE_ROLE);
    const { error } = await admin.rpc("sync_subscription_by_transaction", {
      p_original_transaction_id: originalTxId,
      p_plan: plan,
      p_expires_at: expiresAt,
      p_status: status,
      p_last_transaction_id: tx.transactionId ?? null
    });
    if (error) throw error;

    return new Response("ok", { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("apple-server-notifications error:", msg);
    // A non-2xx response lets Apple's production service retry transient
    // verification and database failures.
    return new Response("processing failed", { status: 500 });
  }
});

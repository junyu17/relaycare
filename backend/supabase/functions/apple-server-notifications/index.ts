// Edge Function: apple-server-notifications
// 接收 App Store Server Notifications V2，按续订/退款/撤销/到期同步家庭 entitlement。
//
// 配置：App Store Connect -> App -> App Store Server Notifications V2 -> 生产/Sandbox URL
//   指向本函数：https://<project>.functions.supabase.co/apple-server-notifications
// Secrets：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（自动注入）/ APPLE_BUNDLE_ID / APPLE_ENVIRONMENT。APPLE_APP_APPLE_ID 已内置默认 6794837934。

import { SignedDataVerifier } from "npm:@apple/app-store-server-library@1.4.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUNDLE_ID = Deno.env.get("APPLE_BUNDLE_ID") ?? "cd.cc.relaycare";
const ENVIRONMENT = (Deno.env.get("APPLE_ENVIRONMENT") ?? "Sandbox") as "Sandbox" | "Production";
// App 的 Apple ID（ASC -> App Information）。非密钥，内置默认；可用环境变量覆盖。
const APP_APPLE_ID = Deno.env.get("APPLE_APP_APPLE_ID") ?? "6794837934";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPA_URL = Deno.env.get("SUPABASE_URL");

const SKU_TO_PLAN: Record<string, "monthly" | "yearly"> = {
  "TaskKin.care.pro.yearly": "yearly",
  "TaskKin.care.pro.mon": "monthly"
};

const ROOT_CERT_URLS = [
  "https://www.apple.com/certificateauthority/AppleRootCA-G3.cer",
  "https://www.apple.com/certificateauthority/AppleComputerRootCertificate.cer",
  "https://www.apple.com/certificateauthority/AppleRootCA.cer"
];

let verifierPromise: Promise<SignedDataVerifier> | null = null;
async function getVerifier(): Promise<SignedDataVerifier> {
  if (!verifierPromise) {
    verifierPromise = (async () => {
      const certs = await Promise.all(
        ROOT_CERT_URLS.map(async (url) => {
          const res = await fetch(url);
          return new Uint8Array(await res.arrayBuffer());
        })
      );
      return new SignedDataVerifier(
        certs,
        true,
        ENVIRONMENT,
        BUNDLE_ID,
        APP_APPLE_ID ? Number(APP_APPLE_ID) : undefined
      );
    })();
  }
  return verifierPromise;
}

// 通知类型 -> 订阅状态。DID_CHANGE_RENEWAL_PREF（关闭自动续订）不立即取消，到期前仍有效。
function statusFor(type: string): "active" | "expired" | "revoked" | "canceled" {
  if (type === "CANCEL" || type === "REFUND" || type === "REVOKE") return "revoked";
  if (type === "EXPIRED" || type === "GRACE_PERIOD_EXPIRED") return "expired";
  return "active"; // SUBSCRIBED, DID_RENEW, RECOVERY, PRICE_INCREASE, DID_CHANGE_RENEWAL_PREF, ...
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  if (!SERVICE_ROLE || !SUPA_URL) return new Response("misconfigured", { status: 500 });

  try {
    const { signedPayload } = await req.json();
    if (!signedPayload) return new Response("ok", { status: 200 });

    const verifier = await getVerifier();
    const notification = await verifier.verifyAndDecodeNotification(signedPayload);
    const type = notification.notificationType ?? "";

    // 解码内嵌的签名交易，取 productId / 到期 / originalTransactionId。
    const signedTx = notification.data?.signedTransactionInfo;
    if (!signedTx) return new Response("ok", { status: 200 }); // TEST 通知等无交易信息。
    const tx = await verifier.verifyAndDecodeTransaction(signedTx);

    const plan = SKU_TO_PLAN[tx.productId];
    if (!plan) return new Response("ok", { status: 200 }); // 非本产品，忽略。

    const status = statusFor(type);
    const expiresAt = tx.expiresDate ? new Date(tx.expiresDate).toISOString() : null;
    const originalTxId = tx.originalTransactionId ?? tx.transactionId;
    if (!originalTxId) return new Response("ok", { status: 200 });

    const admin = createClient(SUPA_URL, SERVICE_ROLE);
    await admin.rpc("sync_subscription_by_transaction", {
      p_original_transaction_id: originalTxId,
      p_plan: plan,
      p_expires_at: expiresAt,
      p_status: status,
      p_last_transaction_id: tx.transactionId ?? null
    });

    return new Response("ok", { status: 200 });
  } catch (e) {
    // Apple 要求 200 即使处理失败（否则会重试），但仍记录错误。
    const msg = e instanceof Error ? e.message : String(e);
    console.error("apple-server-notifications error:", msg);
    return new Response("ok", { status: 200 });
  }
});

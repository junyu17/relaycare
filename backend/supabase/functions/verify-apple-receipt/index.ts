// Edge Function: verify-apple-receipt
// 校验 StoreKit 2 签名交易（JWS），用 Apple 真实 expiresDate 写 entitlement，
// 处理退款/过期，并登记 subscriptions 表（供 Server Notifications V2 定位家庭）。
//
// 部署：supabase functions deploy verify-apple-receipt
// Secrets：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（自动注入）/ APPLE_BUNDLE_ID / APPLE_ENVIRONMENT(Sandbox|Production)。APPLE_APP_APPLE_ID 已内置默认 6794837934。

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
  if (!SERVICE_ROLE || !SUPA_URL) return json({ ok: false, error: "Server misconfigured" }, 500);

  try {
    const { productId, transactionId, purchaseToken, householdId, ownerId } = await req.json();
    if (!purchaseToken || !householdId || !ownerId || !productId) {
      return json({ ok: false, error: "Missing required fields" }, 400);
    }
    const plan = SKU_TO_PLAN[productId];
    if (!plan) return json({ ok: false, error: "Unknown product id" }, 400);

    const verifier = await getVerifier();
    const tx = await verifier.verifyAndDecodeTransaction(purchaseToken); // 验签 + bundleId + 环境

    if (tx.productId !== productId) return json({ ok: false, error: "Product id mismatch" }, 400);
    // 退款/撤销：不授权。
    if (tx.revocationDate) return json({ ok: false, error: "Transaction revoked/refunded" }, 400);
    // 必须是带到期时间的订阅。
    const expiresMs = tx.expiresDate;
    if (!expiresMs) return json({ ok: false, error: "Not a subscription (no expiry)" }, 400);
    // 已过期：不授权（防止旧交易刷新）。
    if (Date.now() > expiresMs) return json({ ok: false, error: "Subscription expired" }, 400);

    const plusUntil = new Date(expiresMs).toISOString();
    const originalTxId = tx.originalTransactionId ?? tx.transactionId ?? transactionId;
    const admin = createClient(SUPA_URL, SERVICE_ROLE);

    // 登记订阅 + 同步家庭 entitlement（用 Apple 真实到期时间，不再硬编码 365 天）。
    const { error: upErr } = await admin.rpc("upsert_subscription", {
      p_household_id: householdId,
      p_original_transaction_id: originalTxId,
      p_plan: plan,
      p_expires_at: plusUntil,
      p_status: "active",
      p_environment: ENVIRONMENT,
      p_last_transaction_id: tx.transactionId ?? transactionId,
      p_owner_member_id: ownerId
    });
    if (upErr) return json({ ok: false, error: upErr.message }, 500);

    return json({ ok: true, plan, plusUntil, originalTransactionId: originalTxId }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: `Verification failed: ${msg}` }, 500);
  }
});

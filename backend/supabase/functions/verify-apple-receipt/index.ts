// Edge Function: verify-apple-receipt
// 校验 StoreKit 2 签名交易（JWS）并写入家庭 Plus entitlement。
//
// 部署：supabase functions deploy verify-apple-receipt
// 环境变量（Supabase Dashboard -> Edge Functions -> Secrets）：
//   SUPABASE_URL                  已有
//   SUPABASE_SERVICE_ROLE_KEY     已有（service role，绕过 RLS）
//   APPLE_BUNDLE_ID               cd.cc.relaycare（与 app.json 一致）
//   APPLE_APP_APPLE_ID            App 的 Apple ID（可选；App Store Server 校验用）
//   APPLE_ENVIRONMENT             Sandbox | Production（开发期 Sandbox，上架后 Production）
//
// 客户端（src/paywall/iap.ts）购买成功后调用本函数，传 purchaseToken（iOS JWS）。

import { SignedDataVerifier } from "npm:@apple/app-store-server-library@1.4.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUNDLE_ID = Deno.env.get("APPLE_BUNDLE_ID") ?? "cd.cc.relaycare";
const ENVIRONMENT = (Deno.env.get("APPLE_ENVIRONMENT") ?? "Sandbox") as "Sandbox" | "Production";
const APP_APPLE_ID = Deno.env.get("APPLE_APP_APPLE_ID");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPA_URL = Deno.env.get("SUPABASE_URL");

const SKU_TO_PLAN: Record<string, "monthly" | "yearly"> = {
  "TaskKin.care.pro.yearly": "yearly",
  "TaskKin.care.pro.mon": "monthly"
};

// Apple 根证书（运行时拉取，用于校验 JWS 签名链）。
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
        true, // enableOnlineChecks
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

  if (!SERVICE_ROLE || !SUPA_URL) {
    return json({ ok: false, error: "Server misconfigured: missing Supabase secrets" }, 500);
  }

  try {
    const { productId, transactionId, purchaseToken, householdId, ownerId } = await req.json();
    if (!purchaseToken || !householdId || !ownerId || !productId) {
      return json({ ok: false, error: "Missing required fields" }, 400);
    }
    const plan = SKU_TO_PLAN[productId];
    if (!plan) return json({ ok: false, error: "Unknown product id" }, 400);

    // 校验 StoreKit 2 签名交易（JWS）。失败会抛异常。
    const verifier = await getVerifier();
    const transaction = await verifier.verifyAndDecodeTransaction(purchaseToken);

    // 产品 ID 必须匹配（防伪）。
    if (transaction.productId !== productId) {
      return json({ ok: false, error: "Product id mismatch" }, 400);
    }

    // 用 service role 调 set_household_plus 写入 entitlement（绕过 RLS）。
    const admin = createClient(SUPA_URL, SERVICE_ROLE);
    const { error } = await admin.rpc("set_household_plus", {
      p_household_id: householdId,
      p_plan: plan,
      p_owner_member_id: ownerId
    });
    if (error) return json({ ok: false, error: error.message }, 500);

    return json({ ok: true, plan, transactionId: transactionId ?? transaction.transactionId }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: `Verification failed: ${msg}` }, 500);
  }
});

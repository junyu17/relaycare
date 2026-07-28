// Edge Function: verify-apple-receipt
// 校验 StoreKit 2 签名交易（JWS），用 Apple 真实 expiresDate 写 entitlement，
// 处理退款/过期，并登记 subscriptions 表（供 Server Notifications V2 定位家庭）。
//
// 部署：supabase functions deploy verify-apple-receipt
// Secrets：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（自动注入）/ SUPABASE_ANON_KEY / APPLE_BUNDLE_ID。
// Sandbox and Production JWS values are both accepted so TestFlight testing
// continues to work after the production notification URL is configured.

import { Environment, SignedDataVerifier } from "npm:@apple/app-store-server-library@1.4.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Buffer } from "node:buffer";

const BUNDLE_ID = Deno.env.get("APPLE_BUNDLE_ID") ?? "cd.cc.relaycare";
const APP_APPLE_ID = Number(Deno.env.get("APPLE_APPLE_ID") ?? Deno.env.get("APPLE_APP_APPLE_ID") ?? "6794837934");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
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

type AppleEnvironment = Environment.SANDBOX | Environment.PRODUCTION;
const verifierPromises = new Map<AppleEnvironment, Promise<SignedDataVerifier>>();
let rootCertificatesPromise: Promise<Buffer[]> | null = null;

async function getRootCertificates(): Promise<Buffer[]> {
  if (!rootCertificatesPromise) {
    rootCertificatesPromise = Promise.all(
      ROOT_CERT_URLS.map(async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Apple root certificate request failed: ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      })
    );
  }
  try {
    return await rootCertificatesPromise;
  } catch (error) {
    rootCertificatesPromise = null;
    throw error;
  }
}

async function getVerifier(environment: AppleEnvironment): Promise<SignedDataVerifier> {
  let promise = verifierPromises.get(environment);
  if (!promise) {
    promise = (async () => {
      const certs = await getRootCertificates();
      return new SignedDataVerifier(
        certs,
        true,
        environment,
        BUNDLE_ID,
        // appAppleId isn't present in Sandbox transactions.
        environment === Environment.PRODUCTION ? APP_APPLE_ID : undefined
      );
    })();
    verifierPromises.set(environment, promise);
  }
  try {
    return await promise;
  } catch (error) {
    verifierPromises.delete(environment);
    throw error;
  }
}

async function verifyTransaction(purchaseToken: string) {
  let productionError: unknown;
  try {
    const verifier = await getVerifier(Environment.PRODUCTION);
    return { tx: await verifier.verifyAndDecodeTransaction(purchaseToken), environment: Environment.PRODUCTION };
  } catch (error) {
    productionError = error;
  }
  try {
    const verifier = await getVerifier(Environment.SANDBOX);
    return { tx: await verifier.verifyAndDecodeTransaction(purchaseToken), environment: Environment.SANDBOX };
  } catch {
    throw productionError;
  }
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
  if (!SERVICE_ROLE || !SUPA_URL || !ANON_KEY) return json({ ok: false, error: "Server misconfigured" }, 500);

  try {
    const { productId, transactionId, purchaseToken, householdId } = await req.json();
    if (!purchaseToken || !householdId || !productId) {
      return json({ ok: false, error: "Missing required fields" }, 400);
    }
    const plan = SKU_TO_PLAN[productId];
    if (!plan) return json({ ok: false, error: "Unknown product id" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, error: "Not authenticated" }, 401);
    const userClient = createClient(SUPA_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ ok: false, error: "Invalid session" }, 401);

    const admin = createClient(SUPA_URL, SERVICE_ROLE);
    const { data: member, error: memberError } = await admin
      .from("members")
      .select("id, role")
      .eq("household_id", householdId)
      .eq("user_id", userData.user.id)
      .eq("invite_status", "active")
      .maybeSingle();
    if (memberError) return json({ ok: false, error: "Unable to verify household membership" }, 500);
    if (!member || member.role !== "coordinator")
      return json({ ok: false, error: "Only a household coordinator can purchase" }, 403);

    const { tx, environment } = await verifyTransaction(purchaseToken); // 验签 + bundleId + environment

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
    // Register against the authenticated coordinator's household. The database
    // rejects an original transaction previously linked elsewhere.
    const { error: upErr } = await admin.rpc("register_apple_subscription", {
      p_household_id: householdId,
      p_original_transaction_id: originalTxId,
      p_plan: plan,
      p_expires_at: plusUntil,
      p_environment: environment,
      p_last_transaction_id: tx.transactionId ?? transactionId,
      p_owner_member_id: member.id,
      p_owner_user_id: userData.user.id
    });
    if (upErr) return json({ ok: false, error: upErr.message }, 500);

    return json({ ok: true, plan, plusUntil, originalTransactionId: originalTxId }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: `Verification failed: ${msg}` }, 500);
  }
});

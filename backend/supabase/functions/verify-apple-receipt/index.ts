// Edge Function: verify-apple-receipt
// 校验 StoreKit 2 签名交易（JWS），用 Apple 真实 expiresDate 写 entitlement，
// 处理退款/过期，并登记 subscriptions 表（供 Server Notifications V2 定位家庭）。
//
// 部署：supabase functions deploy verify-apple-receipt
// Secrets：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（自动注入）/ SUPABASE_ANON_KEY / APPLE_BUNDLE_ID。
// Sandbox and Production JWS values are both accepted so TestFlight testing
// continues to work after the production notification URL is configured.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assertAppleBundleAndEnvironment, describeAppleJws, verifyAppleJws } from "../_shared/apple-jws.ts";

const BUNDLE_ID = Deno.env.get("APPLE_BUNDLE_ID") ?? "cd.cc.relaycare";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
const SUPA_URL = Deno.env.get("SUPABASE_URL");

const SKU_TO_PLAN: Record<string, "monthly" | "yearly"> = {
  "TaskKin.care.pro.yearly": "yearly",
  "TaskKin.care.pro.mon": "monthly"
};

const VERIFICATION_STATUS_NAMES: Record<number, string> = {
  1: "verification-failure",
  2: "invalid-app-identifier",
  3: "invalid-environment",
  4: "invalid-chain-length",
  5: "invalid-certificate",
  6: "failure"
};

async function verifyTransaction(purchaseToken: string) {
  const jwsSummary = describeAppleJws(purchaseToken);
  try {
    const tx = await verifyAppleJws(purchaseToken);
    assertAppleBundleAndEnvironment(tx, BUNDLE_ID);
    return { tx, environment: String(tx.environment) };
  } catch (error) {
    throw new Error(`Apple JWS verification failed: ${errorMessage(error)}; JWS: ${JSON.stringify(jwsSummary)}`);
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

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") {
      const cause = (error as { cause?: unknown }).cause;
      const causeText = cause ? `; cause: ${errorMessage(cause)}` : "";
      return `${VERIFICATION_STATUS_NAMES[status] ?? `status-${status}`}${causeText}`;
    }
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
    const name = (error as { name?: unknown }).name;
    const code = (error as { code?: unknown }).code;
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== "{}") return serialized;
    if (typeof name === "string" && name) return name;
    if (typeof code === "string" && code) return code;
  }
  return String(error);
}

function fail(code: string, message: string, status: number, extra?: Record<string, unknown>): Response {
  console.error("verify-apple-receipt failed", JSON.stringify({ code, status, ...extra }));
  return json({ ok: false, code, error: message }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200 });
  if (!SERVICE_ROLE || !SUPA_URL || !ANON_KEY) {
    return fail("SERVER_MISCONFIGURED", "Server misconfigured", 500, {
      hasServiceRole: Boolean(SERVICE_ROLE),
      hasSupabaseUrl: Boolean(SUPA_URL),
      hasAnonKey: Boolean(ANON_KEY)
    });
  }

  try {
    const { productId, transactionId, purchaseToken, householdId } = await req.json();
    if (!purchaseToken || !householdId || !productId) {
      return fail("MISSING_REQUIRED_FIELDS", "Missing required fields", 400, {
        hasProductId: Boolean(productId),
        hasTransactionId: Boolean(transactionId),
        hasPurchaseToken: Boolean(purchaseToken),
        hasHouseholdId: Boolean(householdId)
      });
    }
    const plan = SKU_TO_PLAN[productId];
    if (!plan) return fail("UNKNOWN_PRODUCT_ID", "Unknown product id", 400, { productId });

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return fail("NOT_AUTHENTICATED", "Not authenticated", 401);
    const userClient = createClient(SUPA_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return fail("INVALID_SESSION", "Invalid session", 401, { authError: userError?.message ?? null });
    }

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
    if (!member) {
      return fail("NOT_HOUSEHOLD_MEMBER", "You are not an active member of this household", 403, { householdId });
    }
    if (member.role !== "coordinator") {
      return fail("COORDINATOR_REQUIRED", "Only a household coordinator can purchase", 403, { role: member.role });
    }

    const { tx, environment } = await verifyTransaction(purchaseToken); // 验签 + bundleId + environment

    if (tx.productId !== productId) {
      return fail("PRODUCT_ID_MISMATCH", "Product id mismatch", 400, {
        expectedProductId: productId,
        transactionProductId: tx.productId
      });
    }
    // 退款/撤销：不授权。
    if (tx.revocationDate) return fail("TRANSACTION_REVOKED", "Transaction revoked/refunded", 400);
    // 必须是带到期时间的订阅。
    const expiresMs = tx.expiresDate;
    if (!expiresMs) return fail("NOT_SUBSCRIPTION", "Not a subscription (no expiry)", 400);
    // 已过期：不授权（防止旧交易刷新）。
    if (Date.now() > expiresMs) return fail("SUBSCRIPTION_EXPIRED", "Subscription expired", 400);

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
    if (upErr) {
      return fail("SUBSCRIPTION_REGISTER_FAILED", upErr.message, 500, {
        plan,
        environment,
        householdId,
        originalTransactionId: originalTxId
      });
    }

    console.log(
      "verify-apple-receipt succeeded",
      JSON.stringify({ plan, environment, householdId, originalTransactionId: originalTxId })
    );
    return json({ ok: true, plan, plusUntil, originalTransactionId: originalTxId }, 200);
  } catch (e) {
    return fail("VERIFICATION_FAILED", `Verification failed: ${errorMessage(e)}`, 500);
  }
});

// Edge Function: verify-apple-receipt
// 校验 StoreKit 2 签名交易（JWS），用 Apple 真实 expiresDate 写 entitlement，
// 处理退款/过期，并登记 subscriptions 表（供 Server Notifications V2 定位家庭）。
//
// 部署：supabase functions deploy verify-apple-receipt
// Secrets：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（自动注入）/ SUPABASE_ANON_KEY / APPLE_BUNDLE_ID。
// 环境策略（B5）：生产默认只接受 Production JWS。
//   APPLE_ACCEPTED_ENVIRONMENTS=Production（显式覆盖，逗号分隔）
//   ALLOW_SANDBOX_PURCHASES=true（仅 TestFlight/沙盒调试时追加 Sandbox）
// 客户端购买必须携带 appAccountToken=auth.uid()（服务端校验绑定，防订阅劫持）；
// signedDate 超过 24h 的旧交易拒绝（防退款/状态变更后重放）。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  acceptedEnvironmentsFromEnv,
  assertAppleBundleAndEnvironment,
  describeAppleJws,
  shorten,
  verifyAppleJws
} from "../_shared/apple-jws.ts";

const BUNDLE_ID = Deno.env.get("APPLE_BUNDLE_ID") ?? "cd.cc.relaycare";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
const SUPA_URL = Deno.env.get("SUPABASE_URL");

const ACCEPTED_ENVIRONMENTS = acceptedEnvironmentsFromEnv(
  Deno.env.get("APPLE_ACCEPTED_ENVIRONMENTS"),
  Deno.env.get("ALLOW_SANDBOX_PURCHASES")
);
// B5: signedDate 新鲜度阈值。StoreKit 2 的 signedDate 是交易创建/续订时间（非 JWS 签发时间），
// 首次购买严格 24h；恢复购买（restore）按订阅周期放宽（月付 31 天 / 年付 370 天），避免误伤合法恢复。
const STALE_SIGNED_DATE_MS = 24 * 60 * 60 * 1000;
const RESTORE_STALE_MS: Record<string, number> = {
  monthly: 31 * 24 * 60 * 60 * 1000,
  yearly: 370 * 24 * 60 * 60 * 1000
};

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
    assertAppleBundleAndEnvironment(tx, BUNDLE_ID, ACCEPTED_ENVIRONMENTS);
    return { tx, environment: String(tx.environment) };
  } catch (error) {
    // B5: 细节只进服务端日志；客户端只收到通用失败消息。
    console.error(
      "verify-apple-receipt: JWS verification failed",
      JSON.stringify({ jwsSummary, detail: errorMessage(error) })
    );
    throw new Error("Apple JWS verification failed");
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
    const { productId, transactionId, purchaseToken, householdId, mode } = await req.json();
    const isRestore = mode === "restore"; // 恢复购买路径（StoreKit getAvailablePurchases）
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
      return fail("INVALID_SESSION", "Invalid session", 401);
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
    // B5: 交易必须绑定当前用户（appAccountToken = auth.uid()），防订阅劫持。
    if (!tx.appAccountToken || String(tx.appAccountToken) !== userData.user.id) {
      return fail(
        "ACCOUNT_TOKEN_MISMATCH",
        "This purchase is not bound to your account. Please restore purchases.",
        403,
        {
          jwsHasAccountToken: Boolean(tx.appAccountToken)
        }
      );
    }
    // B5: signedDate 新鲜度，防退款/状态变更前的旧 JWS 重放。恢复购买按订阅周期放宽阈值。
    const signedMs = Number(tx.signedDate);
    const staleMs = isRestore ? (RESTORE_STALE_MS[plan] ?? STALE_SIGNED_DATE_MS) : STALE_SIGNED_DATE_MS;
    if (!Number.isFinite(signedMs) || signedMs <= 0 || Date.now() - signedMs > staleMs) {
      return fail("STALE_TRANSACTION", "This purchase receipt is too old to verify. Please restore purchases.", 400, {
        staleMs,
        mode
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

    // B5: 交易状态一致性（purchase 与 restore 统一执行，防 mode 切换绕过）——
    // 已登记的订阅若处于 revoked/expired 不允许重新激活（退款/过期后旧 JWS 重放防护）。
    // 首次购买（无记录）放行；恢复购买必须已有登记记录且属于本用户。
    const { data: sub, error: subErr } = await admin
      .from("subscriptions")
      .select("status, owner_user_id")
      .eq("original_transaction_id", originalTxId)
      .maybeSingle();
    if (subErr) {
      return fail("SUBSCRIPTION_LOOKUP_FAILED", "Unable to verify subscription. Please try again.", 500, {
        dbError: subErr.message
      });
    }
    if (sub && (sub.status === "revoked" || sub.status === "expired")) {
      return fail(
        "SUBSCRIPTION_NOT_RESTORABLE",
        "This subscription has been revoked or expired and cannot be reactivated.",
        400
      );
    }
    if (isRestore && (!sub || (sub.owner_user_id !== null && sub.owner_user_id !== userData.user.id))) {
      return fail("RESTORE_NOT_ALLOWED", "This subscription cannot be restored in its current state.", 400);
    }
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
      return fail(
        "SUBSCRIPTION_REGISTER_FAILED",
        "Unable to register subscription. Please try again or restore purchases.",
        500,
        {
          dbError: upErr.message,
          plan,
          environment,
          householdId,
          originalTransactionId: shorten(originalTxId)
        }
      );
    }

    console.log(
      "verify-apple-receipt succeeded",
      JSON.stringify({ plan, environment, householdId, originalTransactionId: shorten(originalTxId) })
    );
    return json({ ok: true, plan, plusUntil }, 200);
  } catch (e) {
    // B5: 客户端只收到通用失败消息，细节进服务端日志。
    console.error("verify-apple-receipt unexpected failure", errorMessage(e));
    return fail("VERIFICATION_FAILED", "Unable to verify purchase. Please try again or restore purchases.", 500);
  }
});

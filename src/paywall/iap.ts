import { Platform } from "react-native";
import {
  initConnection,
  fetchProducts,
  requestPurchase,
  finishTransaction,
  getAvailablePurchases,
  getTransactionJwsIOS,
  purchaseUpdatedListener,
  purchaseErrorListener,
  type Purchase,
  type ProductSubscription
} from "expo-iap";
import { supabase } from "../lib/supabase";
import type { Plan } from "../types";

export type { ProductSubscription };

// ============ iOS 订阅产品（App Store Connect）============
// Yearly: Apple ID 6795121970 / Monthly: Apple ID 6795120026
export const IOS_SUB_SKUS = {
  yearly: "TaskKin.care.pro.yearly",
  monthly: "TaskKin.care.pro.mon"
} as const;

const SKU_TO_PLAN: Record<string, "monthly" | "yearly"> = {
  [IOS_SUB_SKUS.yearly]: "yearly",
  [IOS_SUB_SKUS.monthly]: "monthly"
};

export function skuForPlan(plan: "monthly" | "yearly"): string {
  return plan === "yearly" ? IOS_SUB_SKUS.yearly : IOS_SUB_SKUS.monthly;
}

export function isIapAvailable(): boolean {
  // iOS（StoreKit 2）与 Android（Google Play Billing）均支持；Play 产品与订阅需在
  // Google Play Console 以相同 SKU 创建（TaskKin.care.pro.yearly / TaskKin.care.pro.mon）。
  return Platform.OS === "ios" || Platform.OS === "android";
}
// 兼容旧名（调用方迁移到 isIapAvailable）
export function isIosIapAvailable(): boolean {
  return isIapAvailable();
}

// ============ 连接 + 监听（listener 作为 requestPurchase 返回值的兜底）============
let connectionReady = false;
let listenerInstalled = false;
let pendingResolver: ((p: Purchase) => void) | null = null;
let pendingRejecter: ((e: Error) => void) | null = null;

export async function initIap(): Promise<void> {
  if (!isIapAvailable()) return;
  if (!listenerInstalled) {
    listenerInstalled = true;
    purchaseUpdatedListener((purchase) => {
      if (pendingResolver) {
        const resolve = pendingResolver;
        pendingResolver = null;
        pendingRejecter = null;
        resolve(purchase);
      } else {
        // I1: 无等待者（如冷启动时 StoreKit 推送待完成交易）——best-effort finish，
        // 避免交易永久 pending 反复推送；entitlement 由"恢复购买"重新校验。
        finishTransaction({ purchase }).catch(() => {});
      }
    });
    purchaseErrorListener((error) => {
      if (pendingRejecter) {
        const reject = pendingRejecter;
        pendingResolver = null;
        pendingRejecter = null;
        reject(new Error(error.message || "Purchase failed"));
      }
    });
  }
  if (!connectionReady) {
    await initConnection();
    connectionReady = true;
  }
}

// ============ 拉取订阅产品（含本地化价格）============
export async function fetchIosSubscriptions(): Promise<ProductSubscription[]> {
  await initIap();
  if (!isIapAvailable()) return [];
  const result = await fetchProducts({ skus: Object.values(IOS_SUB_SKUS), type: "subs" });
  return (result ?? []) as ProductSubscription[];
}

// ============ 发起购买 ============
export async function purchaseIosSubscription(plan: "monthly" | "yearly"): Promise<Purchase> {
  await initIap();
  if (!isIapAvailable()) throw new Error("In-app purchase is not available on this platform.");
  const listenerPromise = new Promise<Purchase>((resolve, reject) => {
    pendingResolver = resolve;
    pendingRejecter = reject;
  });
  try {
    // B5/Android: 绑定当前用户——iOS appAccountToken、Android obfuscatedAccountId，
    // 服务端据此校验交易归属（防订阅劫持）。
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id ?? null;
    const result = await requestPurchase({
      request: {
        apple: { sku: skuForPlan(plan), appAccountToken: userId },
        google: { skus: [skuForPlan(plan)], obfuscatedAccountId: userId }
      },
      type: "subs"
    });
    const purchase = Array.isArray(result) ? result[0] : result;
    if (purchase) {
      pendingResolver = null;
      pendingRejecter = null;
      return purchase;
    }
  } catch (e) {
    pendingResolver = null;
    pendingRejecter = null;
    const err = e as { code?: string; message?: string };
    const code = err?.code ? ` (${err.code})` : "";
    const msg = err?.message ? String(err.message) : String(e);
    throw new Error(`${msg}${code}`);
  }
  // requestPurchase 未直接返回（部分情况）-> 等 listener。
  return listenerPromise;
}

// ============ 收据校验：发到 Supabase Edge Function 验证 ============
// iOS：verify-apple-receipt（StoreKit 2 JWS）；Android：verify-google-purchase（Play purchaseToken）。
export async function verifyApplePurchase(args: {
  purchase: Purchase;
  householdId: string;
  mode?: "purchase" | "restore";
}): Promise<{ ok: boolean; plan: Plan | null }> {
  const plan = SKU_TO_PLAN[args.purchase.productId] ?? null;
  if (!plan) return { ok: false, plan: null };
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (sessionError || !accessToken) {
    throw new Error("Not signed in. Please sign in again, then restore or retry the purchase.");
  }
  const isAndroid = Platform.OS === "android";
  const transactionJws = isAndroid ? null : await getTransactionJwsIOS(args.purchase.productId).catch(() => null);
  const purchaseToken = isAndroid
    ? (args.purchase.purchaseToken ?? null) // Android: Play purchaseToken
    : (transactionJws || args.purchase.purchaseToken || null); // iOS: JWS（签名交易）
  const functionName = isAndroid ? "verify-google-purchase" : "verify-apple-receipt";
  const { data, error } = await supabase.functions.invoke(functionName, {
    headers: { Authorization: `Bearer ${accessToken}` },
    body: {
      productId: args.purchase.productId,
      transactionId: args.purchase.transactionId,
      purchaseToken, // iOS JWS / Android Play purchaseToken
      householdId: args.householdId,
      mode: args.mode ?? "purchase"
    }
  });
  if (error) {
    let detail = error.message;
    const context = (error as { context?: unknown }).context as
      (Response & { status?: number; statusText?: string }) | undefined;
    if (context && typeof context === "object" && typeof context.clone === "function") {
      try {
        const body = (await context.clone().json()) as { error?: unknown; message?: unknown; code?: unknown };
        const bodyMessage = body.error ?? body.message;
        if (typeof bodyMessage === "string" && bodyMessage) {
          const code = typeof body.code === "string" && body.code ? ` (${body.code})` : "";
          detail = `${bodyMessage}${code}`;
        }
      } catch {
        try {
          const bodyText = await context.clone().text();
          if (bodyText) detail = bodyText;
        } catch {
          // Keep the Supabase SDK error message.
        }
      }
      const status = context.status ? `HTTP ${context.status}` : "";
      if (status && detail === error.message) detail = `${detail} (${status})`;
    }
    throw new Error(detail);
  }
  return { ok: Boolean(data?.ok), plan: data?.ok ? plan : null };
}

export async function finishIosPurchase(purchase: Purchase): Promise<void> {
  try {
    await finishTransaction({ purchase });
  } catch {
    // best-effort finish
  }
}

// ============ 恢复购买 ============
export async function restoreIos(householdId: string): Promise<Plan | null> {
  await initIap();
  if (!isIosIapAvailable()) return null;
  const purchases = await getAvailablePurchases();
  let infraError: unknown = null;
  for (const purchase of purchases) {
    if (!SKU_TO_PLAN[purchase.productId]) continue;
    try {
      const result = await verifyApplePurchase({ purchase, householdId, mode: "restore" });
      if (result.ok) {
        await finishIosPurchase(purchase);
        return result.plan;
      }
      // result.ok === false：服务端明确拒绝（已撤销/过期/环境不符等），记录并继续下一笔。
      console.warn("restoreIos: purchase rejected", purchase.productId);
    } catch (e) {
      // I1: 基础设施错误（网络/会话过期）——中断并透传给 UI，避免误报"无恢复项"。
      infraError = e;
      break;
    }
  }
  if (infraError) throw infraError instanceof Error ? infraError : new Error(String(infraError));
  return null;
}

import { Platform } from "react-native";
import {
  initConnection,
  fetchProducts,
  requestPurchase,
  finishTransaction,
  getAvailablePurchases,
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

export function isIosIapAvailable(): boolean {
  return Platform.OS === "ios";
}

// ============ 连接 + 监听（listener 作为 requestPurchase 返回值的兜底）============
let connectionReady = false;
let listenerInstalled = false;
let pendingResolver: ((p: Purchase) => void) | null = null;
let pendingRejecter: ((e: Error) => void) | null = null;

export async function initIap(): Promise<void> {
  if (!isIosIapAvailable()) return;
  if (!listenerInstalled) {
    listenerInstalled = true;
    purchaseUpdatedListener((purchase) => {
      if (pendingResolver) {
        const resolve = pendingResolver;
        pendingResolver = null;
        pendingRejecter = null;
        resolve(purchase);
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
  if (!isIosIapAvailable()) return [];
  const result = await fetchProducts({ skus: Object.values(IOS_SUB_SKUS), type: "subs" });
  return (result ?? []) as ProductSubscription[];
}

// ============ 发起购买 ============
export async function purchaseIosSubscription(plan: "monthly" | "yearly"): Promise<Purchase> {
  await initIap();
  if (!isIosIapAvailable()) throw new Error("In-app purchase is only available on iOS.");
  const listenerPromise = new Promise<Purchase>((resolve, reject) => {
    pendingResolver = resolve;
    pendingRejecter = reject;
  });
  try {
    const result = await requestPurchase({ request: { apple: { sku: skuForPlan(plan) } }, type: "subs" });
    const purchase = Array.isArray(result) ? result[0] : result;
    if (purchase) {
      pendingResolver = null;
      pendingRejecter = null;
      return purchase;
    }
  } catch (e) {
    pendingResolver = null;
    pendingRejecter = null;
    throw e instanceof Error ? e : new Error(String(e));
  }
  // requestPurchase 未直接返回（部分情况）-> 等 listener。
  return listenerPromise;
}

// ============ 收据校验：发到 Supabase Edge Function 验证 StoreKit 2 JWS ============
export async function verifyApplePurchase(args: {
  purchase: Purchase;
  householdId: string;
  ownerId: string;
}): Promise<{ ok: boolean; plan: Plan | null }> {
  const plan = SKU_TO_PLAN[args.purchase.productId] ?? null;
  if (!plan) return { ok: false, plan: null };
  const { data, error } = await supabase.functions.invoke("verify-apple-receipt", {
    body: {
      productId: args.purchase.productId,
      transactionId: args.purchase.transactionId,
      purchaseToken: args.purchase.purchaseToken ?? null, // iOS JWS（签名交易）
      householdId: args.householdId,
      ownerId: args.ownerId
    }
  });
  if (error) throw error;
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
export async function restoreIos(householdId: string, ownerId: string): Promise<Plan | null> {
  await initIap();
  if (!isIosIapAvailable()) return null;
  const purchases = await getAvailablePurchases();
  for (const purchase of purchases) {
    if (!SKU_TO_PLAN[purchase.productId]) continue;
    try {
      const result = await verifyApplePurchase({ purchase, householdId, ownerId });
      if (result.ok) {
        await finishIosPurchase(purchase);
        return result.plan;
      }
    } catch {
      // try next purchase
    }
  }
  return null;
}

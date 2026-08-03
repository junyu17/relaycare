// 订阅 SKU 定义（纯模块，无 react-native 依赖，可单测）。
// iOS（App Store）与 Android（Google Play）使用独立 ID：
// Google Play 禁止大写且 Product ID 创建后不可改，故 Android 用小写独立 ID。

export const IOS_SUB_SKUS = {
  yearly: "TaskKin.care.pro.yearly",
  monthly: "TaskKin.care.pro.mon"
} as const;

export const ANDROID_SUB_SKUS = {
  yearly: "taskkin.care.pro.yearly",
  monthly: "taskkin.care.pro.monthly"
} as const;

export const SKU_TO_PLAN: Record<string, "monthly" | "yearly"> = {
  [IOS_SUB_SKUS.yearly]: "yearly",
  [IOS_SUB_SKUS.monthly]: "monthly",
  [ANDROID_SUB_SKUS.yearly]: "yearly",
  [ANDROID_SUB_SKUS.monthly]: "monthly"
};

export function skuForPlan(plan: "monthly" | "yearly", platform: string): string {
  if (platform === "android") {
    return plan === "yearly" ? ANDROID_SUB_SKUS.yearly : ANDROID_SUB_SKUS.monthly;
  }
  return plan === "yearly" ? IOS_SUB_SKUS.yearly : IOS_SUB_SKUS.monthly;
}

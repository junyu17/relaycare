import { describe, expect, it } from "vitest";
import { ANDROID_SUB_SKUS, IOS_SUB_SKUS, SKU_TO_PLAN, skuForPlan } from "../paywall/skus";

describe("subscription SKUs (platform alignment)", () => {
  it("Android SKUs are lowercase (Google Play rule; product id immutable after creation)", () => {
    for (const sku of Object.values(ANDROID_SUB_SKUS)) {
      expect(sku).toMatch(/^[a-z0-9._]+$/);
      expect(sku).not.toMatch(/[A-Z]/);
    }
    expect(ANDROID_SUB_SKUS.yearly).toBe("taskkin.care.pro.yearly");
    expect(ANDROID_SUB_SKUS.monthly).toBe("taskkin.care.pro.monthly");
  });

  it("iOS SKUs remain the App Store identifiers", () => {
    expect(IOS_SUB_SKUS.yearly).toBe("TaskKin.care.pro.yearly");
    expect(IOS_SUB_SKUS.monthly).toBe("TaskKin.care.pro.mon");
  });

  it("SKU_TO_PLAN resolves both platforms to the same plan", () => {
    expect(SKU_TO_PLAN[ANDROID_SUB_SKUS.yearly]).toBe("yearly");
    expect(SKU_TO_PLAN[ANDROID_SUB_SKUS.monthly]).toBe("monthly");
    expect(SKU_TO_PLAN[IOS_SUB_SKUS.yearly]).toBe("yearly");
    expect(SKU_TO_PLAN[IOS_SUB_SKUS.monthly]).toBe("monthly");
  });

  it("platform SKU sets are disjoint (no collision between stores)", () => {
    const android = new Set<string>(Object.values(ANDROID_SUB_SKUS));
    for (const ios of Object.values(IOS_SUB_SKUS)) {
      expect(android.has(ios as string)).toBe(false);
    }
  });

  it("skuForPlan picks the right store by platform", () => {
    expect(skuForPlan("monthly", "android")).toBe(ANDROID_SUB_SKUS.monthly);
    expect(skuForPlan("yearly", "android")).toBe(ANDROID_SUB_SKUS.yearly);
    expect(skuForPlan("monthly", "ios")).toBe(IOS_SUB_SKUS.monthly);
    expect(skuForPlan("yearly", "ios")).toBe(IOS_SUB_SKUS.yearly);
  });
});

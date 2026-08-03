import { describe, expect, it } from "vitest";
import { canUse, PLAN_FEATURES, PLAN_LIMITS, type FeatureKey } from "../lib/entitlement";
import { translations } from "../i18n";

describe("R8 unified entitlement gate (IOS_SUBMISSION_DEV_SPEC)", () => {
  it("free plan blocks every Plus feature", () => {
    for (const key of Object.keys(PLAN_FEATURES) as FeatureKey[]) {
      expect(canUse(key, "free"), `free should not allow ${key}`).toBe(false);
    }
  });

  it("plus plans allow every Plus feature", () => {
    for (const key of Object.keys(PLAN_FEATURES) as FeatureKey[]) {
      expect(canUse(key, "monthly"), `monthly should allow ${key}`).toBe(true);
      expect(canUse(key, "yearly"), `yearly should allow ${key}`).toBe(true);
    }
  });

  it("PLAN_FEATURES free column is backed by PLAN_LIMITS (no UI overstating)", () => {
    // backedBy 一致性：free 列必须与 PLAN_LIMITS.free 的真实配额一致
    expect(PLAN_FEATURES.export.free).toBe(PLAN_LIMITS.free.exportEnabled);
    expect(PLAN_FEATURES.weeklyReportAuto.free).toBe(PLAN_LIMITS.free.weeklyReportAuto);
    expect(PLAN_FEATURES.advancedNotifications.free).toBe(PLAN_LIMITS.free.advancedNotifications);
    expect(PLAN_FEATURES.households3.free).toBe(false); // free=1 家庭
    expect(PLAN_FEATURES.members12.free).toBe(false); // free=3 成员
    expect(PLAN_FEATURES.tasksUnlimited.free).toBe(false); // free=10 进行中
    expect(PLAN_FEATURES.ocr50.free).toBe(false); // free=1 OCR
    expect(PLAN_FEATURES.auditRetention1095.free).toBe(false); // free=30 天
  });

  it("every feature label key exists in all three languages", () => {
    for (const key of Object.keys(PLAN_FEATURES) as FeatureKey[]) {
      const labelKey = PLAN_FEATURES[key].labelKey;
      for (const lang of ["en", "zh", "es"] as const) {
        const value = translations[lang][labelKey];
        expect(value, `${lang} missing ${labelKey}`).toBeTruthy();
      }
    }
  });
});

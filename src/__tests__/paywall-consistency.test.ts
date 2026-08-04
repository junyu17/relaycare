import { describe, expect, it } from "vitest";
import { canUse, PLAN_FEATURES, PLAN_LIMITS, MAX_FILE_SIZE_BYTES } from "../lib/entitlement";
import { ROWS } from "../paywall/paywallRows";

// E（最高标准清零）：storage/report 展示值从常量派生，不再硬编码（改常量即失败）。
const storageLabel = `${Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024)} MB`;

describe("paywall-consistency (R8, IOS_SUBMISSION_DEV_SPEC)", () => {
  it("every ROWS row with backedBy is actually Plus-gated by canUse", () => {
    for (const row of ROWS) {
      if (!row.backedBy) continue; // 无 gated 卖点（如 storage）跳过
      expect(canUse(row.backedBy, "free"), `${row.labelKey} should be free-blocked`).toBe(false);
      expect(canUse(row.backedBy, "yearly"), `${row.labelKey} should be plus-allowed`).toBe(true);
    }
  });

  it("A3 (R4): every ROWS cell matches PLAN_LIMITS exactly (table-driven, no self-exempt branches)", () => {
    const byLabel = Object.fromEntries(ROWS.map((r) => [r.labelKey, r]));
    const row = (key: string) => byLabel[key]!;
    // 展示值 → 期望值 查表：改行文案/改常量都会使断言失败（不再是条件分支自我豁免）
    const EXPECT: Record<string, { free: string; plus: string }> = {
      "paywall.row.households": {
        free: String(PLAN_LIMITS.free.households),
        plus: String(PLAN_LIMITS.monthly.households)
      },
      "paywall.row.members": { free: String(PLAN_LIMITS.free.members), plus: String(PLAN_LIMITS.monthly.members) },
      "paywall.row.tasks": { free: String(PLAN_LIMITS.free.inProgressTasks), plus: "∞" },
      "paywall.row.storage": { free: storageLabel, plus: storageLabel },
      "paywall.row.report": { free: "reportManual", plus: "reportAuto" },
      "paywall.row.ocr": { free: String(PLAN_LIMITS.free.ocrPerMonth), plus: String(PLAN_LIMITS.monthly.ocrPerMonth) },
      "paywall.row.audit": { free: "30 days", plus: "3 years" },
      "paywall.row.export": { free: "none", plus: "PDF/CSV" },
      "paywall.row.notifications": { free: "none", plus: "✓" }
    };
    for (const [key, exp] of Object.entries(EXPECT)) {
      expect(row(key).free, `${key}.free`).toBe(exp.free);
      expect(row(key).plus, `${key}.plus`).toBe(exp.plus);
    }
    // 文案 ↔ 常量 双验证（audit "3 years" ↔ 1095 天；free "30 days" ↔ 30 天）
    expect(PLAN_LIMITS.free.auditRetentionDays).toBe(30);
    expect(PLAN_LIMITS.monthly.auditRetentionDays).toBe(1095);
  });

  it("ROWS covers every PLAN_FEATURES feature (no unshown gated feature)", () => {
    const gated = new Set(ROWS.filter((r) => r.backedBy).map((r) => r.backedBy));
    for (const key of Object.keys(PLAN_FEATURES)) {
      expect(gated.has(key as never), `feature ${key} must appear in paywall ROWS`).toBe(true);
    }
  });
});

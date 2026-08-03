import { describe, expect, it } from "vitest";
import { canUse, PLAN_FEATURES, PLAN_LIMITS } from "../lib/entitlement";
import { ROWS } from "../paywall/paywallRows";

describe("paywall-consistency (R8, IOS_SUBMISSION_DEV_SPEC)", () => {
  it("every ROWS row with backedBy is actually Plus-gated by canUse", () => {
    for (const row of ROWS) {
      if (!row.backedBy) continue; // 无 gated 卖点（如 storage）跳过
      expect(canUse(row.backedBy, "free"), `${row.labelKey} should be free-blocked`).toBe(false);
      expect(canUse(row.backedBy, "yearly"), `${row.labelKey} should be plus-allowed`).toBe(true);
    }
  });

  it("H5: ROWS numeric cells match PLAN_LIMITS (no overstated numbers)", () => {
    const byLabel = Object.fromEntries(ROWS.map((r) => [r.labelKey, r]));
    const row = (key: string) => byLabel[key]!;
    expect(Number(row("paywall.row.members").plus)).toBe(PLAN_LIMITS.monthly.members);
    expect(Number(row("paywall.row.ocr").plus)).toBe(PLAN_LIMITS.monthly.ocrPerMonth);
    // Plus 任务无限：UI 用 "∞" 表示，非数值
    if (row("paywall.row.tasks").plus !== "∞") {
      expect(Number(row("paywall.row.tasks").plus)).toBe(PLAN_LIMITS.monthly.inProgressTasks);
    }
    // 保留期：3 years ↔ 1095 天
    if (row("paywall.row.audit").plus.includes("3")) {
      expect(PLAN_LIMITS.monthly.auditRetentionDays).toBe(1095);
    }
  });

  it("ROWS covers every PLAN_FEATURES feature (no unshown gated feature)", () => {
    const gated = new Set(ROWS.filter((r) => r.backedBy).map((r) => r.backedBy));
    for (const key of Object.keys(PLAN_FEATURES)) {
      expect(gated.has(key as never), `feature ${key} must appear in paywall ROWS`).toBe(true);
    }
  });
});

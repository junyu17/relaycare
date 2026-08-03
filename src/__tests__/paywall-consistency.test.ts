import { describe, expect, it } from "vitest";
import { canUse, PLAN_FEATURES } from "../lib/entitlement";
import { ROWS } from "../paywall/paywallRows";

describe("paywall-consistency (R8, IOS_SUBMISSION_DEV_SPEC)", () => {
  it("every ROWS row with backedBy is actually Plus-gated by canUse", () => {
    for (const row of ROWS) {
      if (!row.backedBy) continue; // 无 gated 卖点（如 storage）跳过
      expect(canUse(row.backedBy, "free"), `${row.labelKey} should be free-blocked`).toBe(false);
      expect(canUse(row.backedBy, "yearly"), `${row.labelKey} should be plus-allowed`).toBe(true);
    }
  });

  it("ROWS covers every PLAN_FEATURES feature (no unshown gated feature)", () => {
    const gated = new Set(ROWS.filter((r) => r.backedBy).map((r) => r.backedBy));
    for (const key of Object.keys(PLAN_FEATURES)) {
      expect(gated.has(key as never), `feature ${key} must appear in paywall ROWS`).toBe(true);
    }
  });
});

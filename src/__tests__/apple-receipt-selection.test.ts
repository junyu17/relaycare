import { describe, expect, it } from "vitest";
import { isCompactJws, selectAppleTransactionJws } from "../paywall/appleReceipt";

const eventJws = "event-header.event-payload.event-signature";
const staleLatestJws = "old-header.old-payload.old-signature";

describe("StoreKit transaction JWS selection", () => {
  it("uses the exact purchase-event JWS instead of a stale SKU lookup", () => {
    expect(selectAppleTransactionJws(eventJws, staleLatestJws)).toBe(eventJws);
  });

  it("uses latestTransaction only when the purchase object lacks a JWS", () => {
    expect(selectAppleTransactionJws("1234567890", staleLatestJws)).toBe(staleLatestJws);
    expect(selectAppleTransactionJws(null, staleLatestJws)).toBe(staleLatestJws);
  });

  it("does not send a transaction id as if it were a signed receipt", () => {
    expect(isCompactJws("1234567890")).toBe(false);
    expect(selectAppleTransactionJws("1234567890", null)).toBeNull();
  });
});

/** StoreKit 2 transaction signatures use compact JWS serialization. */
export function isCompactJws(value: string | null | undefined): value is string {
  if (!value) return false;
  const parts = value.split(".");
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

/**
 * Prefer the JWS attached to the purchase event. Looking up latestTransaction
 * by SKU can return an older transaction after a subscription plan change.
 */
export function selectAppleTransactionJws(
  purchaseToken: string | null | undefined,
  latestTransactionJws: string | null | undefined
): string | null {
  if (isCompactJws(purchaseToken)) return purchaseToken;
  if (isCompactJws(latestTransactionJws)) return latestTransactionJws;
  return null;
}

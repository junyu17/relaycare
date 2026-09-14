// 订阅价格 fallback（服务端/IAP 价格未就绪时展示；与 ASC 订阅披露一致）。
// 单一来源：付费墙与一致性测试均引用，禁止散落硬编码金额。
export const PLAN_FALLBACK_PRICES = {
  monthly: "$9.99",
  yearly: "$69.99"
} as const;

/** Pull a number out of a localized price string ("$69.99", "69,99 €", "¥1,300"). */
export function numericPrice(label: string | null): number | null {
  if (!label) return null;
  const cleaned = label
    .replace(/[^0-9.,]/g, "")
    .replace(/,(?=\d{3}\b)/g, "")
    .replace(",", ".");
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Discount the yearly plan gives over 12 monthly payments; null when not worth showing. */
export function yearlySavingPercent(monthly: string | null, yearly: string | null): number | null {
  const m = numericPrice(monthly);
  const y = numericPrice(yearly);
  if (m === null || y === null) return null;
  const pct = Math.round((1 - y / (m * 12)) * 100);
  return pct >= 5 && pct < 100 ? pct : null;
}

/** iOS free-trial length in days for a plan, read from StoreKit's own
 *  introductory offer. Returns null when the product carries no free trial, so
 *  the paywall falls back to the plain renewal wording instead of promising an
 *  offer the buyer will not get. */
export function freeTrialDays(sub: unknown): number | null {
  const offer = (sub as {
    subscriptionInfoIOS?: { introductoryOffer?: { paymentMode?: string; period?: { unit?: string; value?: number }; periodCount?: number } | null };
  } | null)?.subscriptionInfoIOS?.introductoryOffer;
  if (!offer || offer.paymentMode !== "free-trial") return null;
  const value = offer.period?.value ?? 0;
  const count = offer.periodCount ?? 1;
  const units = value * count;
  switch (offer.period?.unit) {
    case "day": return units;
    case "week": return units * 7;
    case "month": return units * 30;
    case "year": return units * 365;
    default: return null;
  }
}

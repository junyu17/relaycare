import { describe, expect, it } from "vitest";

import { PLAN_FALLBACK_PRICES, numericPrice, yearlySavingPercent } from "../paywall/prices";

describe("numericPrice", () => {
  it("reads the plain US format", () => {
    expect(numericPrice("$69.99")).toBe(69.99);
  });

  it("reads a comma decimal separator", () => {
    expect(numericPrice("69,99 €")).toBe(69.99);
  });

  it("reads a thousands separator without losing the magnitude", () => {
    expect(numericPrice("¥1,300")).toBe(1300);
  });

  it("returns null when there is no usable number", () => {
    expect(numericPrice(null)).toBeNull();
    expect(numericPrice("Unavailable")).toBeNull();
    expect(numericPrice("$0.00")).toBeNull();
  });
});

describe("yearlySavingPercent", () => {
  it("computes the discount the badge shows", () => {
    expect(yearlySavingPercent("$9.99", "$69.99")).toBe(42);
  });

  it("matches the shipped fallback prices", () => {
    expect(yearlySavingPercent(PLAN_FALLBACK_PRICES.monthly, PLAN_FALLBACK_PRICES.yearly)).toBe(42);
  });

  it("hides the badge when yearly is not actually cheaper", () => {
    expect(yearlySavingPercent("$9.99", "$119.88")).toBeNull();
    expect(yearlySavingPercent("$9.99", "$199.99")).toBeNull();
  });

  it("hides the badge when a price is missing", () => {
    expect(yearlySavingPercent(null, "$69.99")).toBeNull();
    expect(yearlySavingPercent("$9.99", null)).toBeNull();
  });
});

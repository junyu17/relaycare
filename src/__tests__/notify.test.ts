import { describe, expect, it } from "vitest";
import { DEFAULT_PREF, isWithinQuietHours, minutesOfDay, shouldDeliverNow } from "../lib/notify";

function at(h: number, m: number): Date {
  const d = new Date(2026, 7, 3, h, m);
  return d;
}

describe("R5 notify (IOS_SUBMISSION_DEV_SPEC)", () => {
  it("minutesOfDay converts HH:MM", () => {
    expect(minutesOfDay("00:00")).toBe(0);
    expect(minutesOfDay("22:00")).toBe(1320);
    expect(minutesOfDay("23:59")).toBe(1439);
  });

  it("isWithinQuietHours: same-day interval", () => {
    const pref = { ...DEFAULT_PREF, quietHoursStart: "09:00", quietHoursEnd: "17:00" };
    expect(isWithinQuietHours(at(8, 59), pref)).toBe(false);
    expect(isWithinQuietHours(at(9, 0), pref)).toBe(true); // 含 start
    expect(isWithinQuietHours(at(12, 0), pref)).toBe(true);
    expect(isWithinQuietHours(at(17, 0), pref)).toBe(false); // 不含 end
  });

  it("isWithinQuietHours: crosses midnight (22:00-07:00 default)", () => {
    expect(isWithinQuietHours(at(21, 59), DEFAULT_PREF)).toBe(false);
    expect(isWithinQuietHours(at(22, 0), DEFAULT_PREF)).toBe(true);
    expect(isWithinQuietHours(at(0, 30), DEFAULT_PREF)).toBe(true);
    expect(isWithinQuietHours(at(6, 59), DEFAULT_PREF)).toBe(true);
    expect(isWithinQuietHours(at(7, 0), DEFAULT_PREF)).toBe(false);
  });

  it("equal start/end means no quiet hours", () => {
    const pref = { ...DEFAULT_PREF, quietHoursStart: "00:00", quietHoursEnd: "00:00" };
    expect(isWithinQuietHours(at(0, 0), pref)).toBe(false);
    expect(isWithinQuietHours(at(12, 0), pref)).toBe(false);
  });

  it("shouldDeliverNow: critical always delivers, digest accumulates non-critical", () => {
    const quiet = { ...DEFAULT_PREF, quietHoursStart: "00:00", quietHoursEnd: "23:59", taskDigest: false };
    expect(shouldDeliverNow("critical", quiet, at(12, 0))).toBe(true); // 静默中 critical 仍投递
    expect(shouldDeliverNow("info", quiet, at(12, 0))).toBe(false); // 非 critical 静默抑制
    const digestOn = { ...DEFAULT_PREF, quietHoursStart: "00:00", quietHoursEnd: "00:00", taskDigest: true };
    expect(shouldDeliverNow("info", digestOn, at(12, 0))).toBe(false); // digest 打开：非 critical 累积
    expect(shouldDeliverNow("critical", digestOn, at(12, 0))).toBe(true);
  });
});

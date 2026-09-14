import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const iapSource = readFileSync(join(__dirname, "../paywall/iap.ts"), "utf8");

describe("IAP account identity", () => {
  it("binds Apple purchases to the authenticated TaskKin user UUID", () => {
    expect(iapSource).toContain("const userId = sessionData.session?.user.id ?? null");
    expect(iapSource).toContain("appAccountToken: userId");
  });

  it("does not use a device or installation identifier for purchase ownership", () => {
    expect(iapSource).not.toMatch(/identifierForVendor|installationId|deviceId|IDFV/);
  });
});

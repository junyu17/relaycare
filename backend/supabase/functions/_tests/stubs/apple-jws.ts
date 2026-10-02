// 测试替身：_tests/deno.json 把 functions/_shared/apple-jws.ts 映射到这里（只在 Deno 测试里）。
// verify-apple-receipt 的测试关心的是协调人 / 恢复购买的授权逻辑，不是 StoreKit 证书链，
// 所以 verifyAppleJws 直接返回测试登记的交易载荷；未登记的 JWS 一律验签失败。
// deno-lint-ignore-file no-explicit-any

export type AppleJwsPayload = Record<string, any>;

function registry(): Map<string, AppleJwsPayload> {
  const g = globalThis as { __taskkinAppleJws?: Map<string, AppleJwsPayload> };
  g.__taskkinAppleJws ??= new Map();
  return g.__taskkinAppleJws;
}

/** 测试用：登记一个「已验签」的交易，返回作为 purchaseToken 的假 JWS。 */
export function registerFakeJws(payload: AppleJwsPayload): string {
  const token = `fake-jws-${crypto.randomUUID()}`;
  registry().set(token, payload);
  return token;
}

export function verifyAppleJws(jws: string): Promise<AppleJwsPayload> {
  const payload = registry().get(jws);
  return payload ? Promise.resolve(payload) : Promise.reject(new Error("fake JWS not registered"));
}

export function assertAppleBundleAndEnvironment(
  payload: AppleJwsPayload,
  expectedBundleId: string,
  acceptedEnvironments = new Set(["Sandbox", "Production"])
): void {
  if (payload.bundleId !== expectedBundleId) throw new Error(`Invalid Apple JWS bundleId: ${String(payload.bundleId)}`);
  if (!acceptedEnvironments.has(String(payload.environment))) {
    throw new Error(`Invalid Apple JWS environment: ${String(payload.environment)}`);
  }
}

export function acceptedEnvironmentsFromEnv(
  explicit: string | undefined,
  allowSandbox: string | undefined
): Set<string> {
  if (explicit && explicit.trim()) {
    return new Set(
      explicit
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }
  const set = new Set(["Production"]);
  if (allowSandbox === "true") set.add("Sandbox");
  return set;
}

export function describeAppleJws(_jws: string): Record<string, unknown> {
  return { fake: true };
}

export function shorten(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return value.length <= 12 ? value : `${value.slice(0, 4)}...${value.slice(-4)}`;
}

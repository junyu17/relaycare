// Sign in with Apple（SIWA）服务端工具。
//   - verifyAppleIdToken：apple-identity-conflict 用它证明调用者确实持有这个 Apple ID
//     （RS256 签名对 Apple JWKS、iss、aud=bundle id、exp、nonce = sha256hex(rawNonce)）。
//   - revokeAppleAuthorization：delete-account 删号时撤销 Apple 授权（App Review 5.1.1(v)）。
//     决策 3A：不长期保存 Apple refresh token；删号时用户重新做一次 Apple 授权，拿到的 authorizationCode
//     当场换 token、核对 sub、再撤销。撤销是尽力而为：任何失败只返回结果类型，由调用方记日志，不影响删除。
//
// 日志与返回值里绝不出现 id_token、authorizationCode、Apple token、sub 或私钥。
//
// Secrets（supabase secrets set，私钥只用 --env-file 读入，不进仓库）：
//   APPLE_BUNDLE_ID（默认 cd.cc.relaycare）、APPLE_TEAM_ID（默认 255R6QQR97）、
//   APPLE_SIWA_KEY_ID、APPLE_SIWA_PRIVATE_KEY（.p8 的 PEM 全文，换行可写成 \n）。

import { createRemoteJWKSet, decodeJwt, importPKCS8, jwtVerify, SignJWT } from "https://esm.sh/jose@5.10.0";

export const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";
const DEFAULT_BUNDLE_ID = "cd.cc.relaycare";
const DEFAULT_TEAM_ID = "255R6QQR97";
const APPLE_HTTP_TIMEOUT_MS = 8000;
// client_secret 的有效期：Apple 允许最长 6 个月，这里只签 5 分钟，用完即弃。
const CLIENT_SECRET_TTL_SECONDS = 300;

let appleJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function appleKeySet(): ReturnType<typeof createRemoteJWKSet> {
  appleJwks ??= createRemoteJWKSet(new URL(APPLE_KEYS_URL), { timeoutDuration: 5000 });
  return appleJwks;
}

/** 原生 Apple 登录的 aud = App 的 bundle id（不是 Services ID）。 */
export function appleClientId(): string {
  return Deno.env.get("APPLE_BUNDLE_ID") ?? DEFAULT_BUNDLE_ID;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 常数时间比较（先各自取 SHA-256，长度不同也不提前返回）。 */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0 && a.length === b.length;
}

/** id_token 校验失败。message 只是原因类别，可以进日志。 */
export class AppleTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppleTokenError";
  }
}

/**
 * 校验客户端从 AppleAuthentication.signInAsync 拿到的 identityToken。
 * rawNonce 是客户端生成的原始 nonce：它的 SHA-256 十六进制交给了 Apple，原始值交给 Supabase 和这里。
 */
export async function verifyAppleIdToken(idToken: string, rawNonce: string): Promise<{ sub: string }> {
  if (!idToken || !rawNonce) throw new AppleTokenError("missing_token_or_nonce");
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(idToken, appleKeySet(), {
      issuer: APPLE_ISSUER,
      audience: appleClientId(),
      algorithms: ["RS256"],
      requiredClaims: ["sub", "exp", "nonce"]
    }));
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "verify_failed";
    throw new AppleTokenError(code);
  }
  const expectedNonce = await sha256Hex(rawNonce);
  if (typeof payload.nonce !== "string" || !(await constantTimeEqual(payload.nonce, expectedNonce))) {
    throw new AppleTokenError("nonce_mismatch");
  }
  if (typeof payload.sub !== "string" || !payload.sub) throw new AppleTokenError("missing_sub");
  return { sub: payload.sub };
}

export interface SiwaConfig {
  teamId: string;
  clientId: string;
  keyId: string;
  privateKeyPem: string;
}

/** 没有配置 SIWA 私钥时返回 null（撤销步骤跳过，删号照常）。 */
export function siwaConfigFromEnv(): SiwaConfig | null {
  const keyId = Deno.env.get("APPLE_SIWA_KEY_ID")?.trim();
  const privateKeyPem = Deno.env.get("APPLE_SIWA_PRIVATE_KEY");
  if (!keyId || !privateKeyPem?.trim()) return null;
  return {
    teamId: Deno.env.get("APPLE_TEAM_ID")?.trim() || DEFAULT_TEAM_ID,
    clientId: appleClientId(),
    keyId,
    privateKeyPem
  };
}

// secrets 里的 PEM 可能把换行写成字面量 \n，也可能带 Windows 换行。
function normalizePem(pem: string): string {
  return pem.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").trim();
}

/** ES256 签名的 client_secret：kid=Key ID，iss=Team ID，sub=client_id，aud=https://appleid.apple.com，有效期 5 分钟。 */
export async function createClientSecret(cfg: SiwaConfig, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await importPKCS8(normalizePem(cfg.privateKeyPem), "ES256");
  return await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: cfg.keyId })
    .setIssuer(cfg.teamId)
    .setSubject(cfg.clientId)
    .setAudience(APPLE_ISSUER)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + CLIENT_SECRET_TTL_SECONDS)
    .sign(key);
}

export type AppleRevokeOutcome =
  | "revoked"
  | "skipped_not_configured"
  | "failed_client_secret"
  | "failed_exchange"
  | "failed_sub_mismatch"
  | "failed_revoke";

function form(fields: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(APPLE_HTTP_TIMEOUT_MS)
  };
}

/**
 * 用删号前刚拿到的 authorizationCode 撤销这个用户对 TaskKin 的 Apple 授权。
 * expectedSubs：该用户在 auth.identities 里 provider='apple' 的 sub。换回来的 id_token 的 sub 必须在其中，
 * 否则不撤销（防止拿别的 Apple ID 的 code 来撤销）。
 * id_token 直接来自 Apple 的 token 端点（TLS），按 OIDC Core 3.1.3.7 只核对 iss / aud / sub，不再验签。
 */
export async function revokeAppleAuthorization(
  authorizationCode: string,
  expectedSubs: string[],
  cfg: SiwaConfig | null = siwaConfigFromEnv()
): Promise<AppleRevokeOutcome> {
  if (!cfg) return "skipped_not_configured";

  let clientSecret: string;
  try {
    clientSecret = await createClientSecret(cfg);
  } catch {
    return "failed_client_secret";
  }

  let tokens: { id_token?: unknown; refresh_token?: unknown; access_token?: unknown };
  try {
    const res = await fetch(
      APPLE_TOKEN_URL,
      form({
        client_id: cfg.clientId,
        client_secret: clientSecret,
        code: authorizationCode,
        grant_type: "authorization_code"
      })
    );
    if (!res.ok) {
      await res.body?.cancel();
      return "failed_exchange";
    }
    tokens = await res.json();
  } catch {
    return "failed_exchange";
  }

  try {
    const claims = decodeJwt(String(tokens.id_token ?? ""));
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== APPLE_ISSUER || !audiences.includes(cfg.clientId)) return "failed_sub_mismatch";
    if (typeof claims.sub !== "string" || !expectedSubs.includes(claims.sub)) return "failed_sub_mismatch";
  } catch {
    return "failed_sub_mismatch";
  }

  const refreshToken = typeof tokens.refresh_token === "string" ? tokens.refresh_token : "";
  const accessToken = typeof tokens.access_token === "string" ? tokens.access_token : "";
  const token = refreshToken || accessToken;
  if (!token) return "failed_exchange";

  try {
    const res = await fetch(
      APPLE_REVOKE_URL,
      form({
        client_id: cfg.clientId,
        client_secret: clientSecret,
        token,
        token_type_hint: refreshToken ? "refresh_token" : "access_token"
      })
    );
    await res.body?.cancel();
    return res.ok ? "revoked" : "failed_revoke";
  } catch {
    return "failed_revoke";
  }
}

/** auth 用户的 Apple sub 列表（GoTrue 的 identity：id / identity_data.sub 都是 Apple sub）。 */
export function appleSubsOf(user: {
  identities?: { provider?: string; id?: string; identity_data?: unknown }[];
}): string[] {
  const subs = new Set<string>();
  for (const identity of user.identities ?? []) {
    if (identity.provider !== "apple") continue;
    const data = (identity.identity_data ?? {}) as { sub?: unknown; provider_id?: unknown };
    for (const candidate of [data.sub, data.provider_id, identity.id]) {
      if (typeof candidate === "string" && candidate) subs.add(candidate);
    }
  }
  return [...subs];
}

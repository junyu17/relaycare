// Edge-compatible Apple JWS verification for StoreKit 2 signed payloads.
// The official Apple Node library calls crypto.X509Certificate.verify(), which
// is not implemented in the Supabase Edge runtime.

import "npm:reflect-metadata@0.2.2";
import { X509Certificate } from "npm:@peculiar/x509@2.0.0";
import { compactVerify } from "https://esm.sh/jose@5.10.0";

export type AppleJwsPayload = Record<string, any>;

const APPLE_LEAF_EXTENSION_OID = "1.2.840.113635.100.6.11.1";
const APPLE_INTERMEDIATE_EXTENSION_OID = "1.2.840.113635.100.6.2.1";
const CERT_TIME_SKEW_MS = 5 * 60 * 1000;

const ROOT_CERT_URLS = [
  "https://www.apple.com/certificateauthority/AppleRootCA-G3.cer",
  "https://www.apple.com/certificateauthority/AppleRootCA-G2.cer",
  "https://www.apple.com/certificateauthority/AppleComputerRootCertificate.cer",
  "https://www.apple.com/appleca/AppleIncRootCertificate.cer"
];

let trustedRootsPromise: Promise<X509Certificate[]> | null = null;

export async function verifyAppleJws(jws: string): Promise<AppleJwsPayload> {
  const { header, unsignedPayload } = decodeCompactJws(jws);
  if (header.alg !== "ES256") throw new Error(`Unsupported Apple JWS algorithm: ${String(header.alg)}`);
  if (!Array.isArray(header.x5c) || header.x5c.length !== 3) {
    throw new Error(
      `Apple JWS certificate chain length is invalid: ${Array.isArray(header.x5c) ? header.x5c.length : 0}`
    );
  }
  if (!header.x5c.every((cert: unknown) => typeof cert === "string" && cert.length > 0)) {
    throw new Error("Apple JWS certificate chain is malformed");
  }

  const leafCert = parseDerBase64Certificate(header.x5c[0]);
  const intermediateCert = parseDerBase64Certificate(header.x5c[1]);
  const signedAt = dateForCertificateValidation(unsignedPayload);

  assertCertificateTime(leafCert, signedAt, "leaf");
  assertCertificateTime(intermediateCert, signedAt, "intermediate");
  if (!hasExtension(leafCert, APPLE_LEAF_EXTENSION_OID)) {
    throw new Error("Apple JWS leaf certificate is missing the Apple signing extension");
  }
  if (!hasExtension(intermediateCert, APPLE_INTERMEDIATE_EXTENSION_OID)) {
    throw new Error("Apple JWS intermediate certificate is missing the Apple CA extension");
  }
  await assertIssuedBy(intermediateCert, leafCert, "leaf");

  const trustedRoot = await findTrustedRoot(intermediateCert, signedAt);
  if (!trustedRoot) {
    throw new Error("Apple JWS certificate chain is not anchored to a trusted Apple root");
  }

  const verificationKey = await leafCert.publicKey.export({ name: "ECDSA", namedCurve: "P-256" }, ["verify"]);
  const verified = await compactVerify(jws, verificationKey, { algorithms: ["ES256"] });
  return JSON.parse(new TextDecoder().decode(verified.payload));
}

export function assertAppleBundleAndEnvironment(
  payload: AppleJwsPayload,
  expectedBundleId: string,
  acceptedEnvironments = new Set(["Sandbox", "Production"])
): void {
  if (payload.bundleId !== expectedBundleId) {
    throw new Error(`Invalid Apple JWS bundleId: ${String(payload.bundleId)}`);
  }
  if (!acceptedEnvironments.has(String(payload.environment))) {
    throw new Error(`Invalid Apple JWS environment: ${String(payload.environment)}`);
  }
}

/**
 * B5: 计算允许的 Apple JWS 环境集合。
 * 显式 `APPLE_ACCEPTED_ENVIRONMENTS`（逗号分隔）优先；否则默认仅 Production，
 * 仅当 `ALLOW_SANDBOX_PURCHASES=true`（TestFlight/沙盒调试）时追加 Sandbox。
 */
export function acceptedEnvironmentsFromEnv(
  explicit: string | undefined,
  allowSandbox: string | undefined
): Set<string> {
  if (explicit && explicit.trim()) {
    return new Set(explicit.split(",").map((s) => s.trim()).filter(Boolean));
  }
  const set = new Set(["Production"]);
  if (allowSandbox === "true") set.add("Sandbox");
  return set;
}

export function describeAppleJws(jws: string): Record<string, unknown> {
  const parts = jws.split(".");
  const header = parts[0] ? decodeBase64UrlJson(parts[0]) : null;
  const payload = parts[1] ? decodeBase64UrlJson(parts[1]) : null;
  const x5c = Array.isArray(header?.x5c) ? header.x5c : [];
  return {
    segmentCount: parts.length,
    alg: header?.alg ?? null,
    hasX5c: x5c.length > 0,
    x5cLength: x5c.length,
    bundleId: payload?.bundleId ?? null,
    productId: payload?.productId ?? null,
    environment: payload?.environment ?? null,
    signedDate: payload?.signedDate ?? null,
    expiresDate: payload?.expiresDate ?? null,
    transactionId: shorten(payload?.transactionId),
    originalTransactionId: shorten(payload?.originalTransactionId)
  };
}

async function getTrustedRoots(): Promise<X509Certificate[]> {
  if (!trustedRootsPromise) {
    trustedRootsPromise = (async () => {
      const results = await Promise.allSettled(
        ROOT_CERT_URLS.map(async (url) => {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
          return parseDerBytesCertificate(new Uint8Array(await res.arrayBuffer()));
        })
      );
      const roots = results.flatMap((result, index) => {
        if (result.status === "fulfilled") return [result.value];
        console.error("Apple root certificate request failed", ROOT_CERT_URLS[index], errorMessage(result.reason));
        return [];
      });
      if (!roots.length) throw new Error("No Apple root certificates could be loaded");
      return roots;
    })();
  }
  try {
    return await trustedRootsPromise;
  } catch (error) {
    trustedRootsPromise = null;
    throw error;
  }
}

async function findTrustedRoot(intermediateCert: X509Certificate, signedAt: Date): Promise<X509Certificate | null> {
  const roots = await getTrustedRoots();
  for (const root of roots) {
    try {
      assertCertificateTime(root, signedAt, "root");
      if (await isIssuedBy(root, intermediateCert)) return root;
    } catch {
      // Try the next trusted Apple root.
    }
  }
  return null;
}

function decodeCompactJws(jws: string): { header: AppleJwsPayload; unsignedPayload: AppleJwsPayload } {
  const parts = jws.split(".");
  if (parts.length !== 3) throw new Error(`Invalid Apple JWS segment count: ${parts.length}`);
  const header = decodeBase64UrlJson(parts[0]);
  const unsignedPayload = decodeBase64UrlJson(parts[1]);
  if (!header || !unsignedPayload) throw new Error("Invalid Apple JWS JSON");
  return { header, unsignedPayload };
}

function decodeBase64UrlJson(segment: string): AppleJwsPayload | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as AppleJwsPayload;
  } catch {
    return null;
  }
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  return base64ToBytes(padded);
}

function base64ToBytes(value: string): Uint8Array {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function parseDerBase64Certificate(base64: string): X509Certificate {
  return new X509Certificate(base64ToBytes(base64));
}

function parseDerBytesCertificate(bytes: Uint8Array): X509Certificate {
  return new X509Certificate(bytes);
}

function dateForCertificateValidation(payload: AppleJwsPayload): Date {
  const signedDate = Number(payload.signedDate);
  return Number.isFinite(signedDate) && signedDate > 0 ? new Date(signedDate) : new Date();
}

function assertCertificateTime(cert: X509Certificate, at: Date, label: string): void {
  const timestamp = at.getTime();
  const notBefore = cert.notBefore.getTime() - CERT_TIME_SKEW_MS;
  const notAfter = cert.notAfter.getTime() + CERT_TIME_SKEW_MS;
  if (timestamp < notBefore || timestamp > notAfter) {
    throw new Error(`Apple JWS ${label} certificate is not valid at signedDate`);
  }
}

function hasExtension(cert: X509Certificate, oid: string): boolean {
  return cert.extensions.some((extension) => extension.type === oid);
}

async function assertIssuedBy(issuer: X509Certificate, child: X509Certificate, childLabel: string): Promise<void> {
  try {
    if (!(await isIssuedBy(issuer, child))) throw new Error("signature check returned false");
  } catch (error) {
    throw new Error(
      `Apple JWS ${childLabel} certificate was not issued by the expected certificate: ${errorMessage(error)}`
    );
  }
}

async function isIssuedBy(issuer: X509Certificate, child: X509Certificate): Promise<boolean> {
  return child.issuer === issuer.subject && (await child.verify({ publicKey: issuer.publicKey, signatureOnly: true }));
}

export function shorten(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return value.length <= 12 ? value : `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

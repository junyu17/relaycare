// _shared/apple-siwa.ts 的纯函数部分：配置缺失时跳过撤销、Apple sub 提取、nonce 哈希与常数时间比较。
import { assert, assertEquals, assertFalse, assertRejects } from "jsr:@std/assert@1";
import {
  appleSubsOf,
  AppleTokenError,
  constantTimeEqual,
  revokeAppleAuthorization,
  sha256Hex,
  siwaConfigFromEnv,
  verifyAppleIdToken
} from "../_shared/apple-siwa.ts";
import { stubFetch } from "./support.ts";

Deno.test("without SIWA key secrets the revoke step is skipped and Apple is never called", async () => {
  Deno.env.delete("APPLE_SIWA_KEY_ID");
  Deno.env.delete("APPLE_SIWA_PRIVATE_KEY");
  assertEquals(siwaConfigFromEnv(), null);
  const apple = stubFetch(() => new Response("unexpected", { status: 599 }));
  try {
    assertEquals(await revokeAppleAuthorization("code", ["sub"]), "skipped_not_configured");
  } finally {
    apple.restore();
  }
  assertEquals(apple.requests, []);
});

Deno.test("a broken private key fails closed for the revoke step only", async () => {
  const outcome = await revokeAppleAuthorization("code", ["sub"], {
    teamId: "T",
    clientId: "cd.cc.relaycare",
    keyId: "K",
    privateKeyPem: "this is not a PKCS#8 key"
  });
  assertEquals(outcome, "failed_client_secret");
});

Deno.test("appleSubsOf reads only Apple identities", () => {
  assertEquals(
    appleSubsOf({
      identities: [
        { provider: "email", id: "x@example.test", identity_data: { sub: "email-sub" } },
        { provider: "apple", id: "001.apple.sub", identity_data: { sub: "001.apple.sub" } },
        { provider: "anonymous" }
      ]
    }),
    ["001.apple.sub"]
  );
  assertEquals(appleSubsOf({}), []);
});

Deno.test("nonce hashing matches the client (SHA-256, lowercase hex) and comparison is exact", async () => {
  assertEquals(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert(await constantTimeEqual("same-value", "same-value"));
  assertFalse(await constantTimeEqual("same-value", "same-valuE"));
  assertFalse(await constantTimeEqual("short", "short-but-longer"));
});

Deno.test("verifyAppleIdToken refuses empty input before any network call", async () => {
  const apple = stubFetch(() => new Response("unexpected", { status: 599 }));
  try {
    await assertRejects(() => verifyAppleIdToken("", "nonce"), AppleTokenError, "missing_token_or_nonce");
    await assertRejects(() => verifyAppleIdToken("a.b.c", ""), AppleTokenError, "missing_token_or_nonce");
  } finally {
    apple.restore();
  }
  assertEquals(apple.requests, []);
});

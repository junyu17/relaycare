// apple-identity-conflict：Apple id_token 校验（stub 掉 fetch 和 JWKS）+ 三种处理结果 + 日志不泄露 token / sub。
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { exportJWK, generateKeyPair, type KeyLike, SignJWT } from "https://esm.sh/jose@5.10.0";
import { sha256Hex } from "../_shared/apple-siwa.ts";
import { bearer, captureConsole, FakeSupabase, installSupabase, loadFunction, stubFetch, TEST_ENV } from "./support.ts";

const BUNDLE_ID = "cd.cc.relaycare";
const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";

const appleKey = await generateKeyPair("RS256", { extractable: true });
const attackerKey = await generateKeyPair("RS256", { extractable: true });
const jwk = { ...(await exportJWK(appleKey.publicKey)), kid: "apple-k1", alg: "RS256", use: "sig" };

// 整个文件只有一个 JWKS 端点；其余任何 HTTP 请求都算测试失败。
let jwksFetches = 0;
const fetchStub = stubFetch((req) => {
  if (req.url === APPLE_KEYS_URL) {
    jwksFetches += 1;
    return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Content-Type": "application/json" } });
  }
  return new Response("unexpected request", { status: 599 });
});

const handler = await loadFunction(new URL("../apple-identity-conflict/index.ts", import.meta.url).href, {
  ...TEST_ENV,
  APPLE_BUNDLE_ID: BUNDLE_ID
});

interface Account {
  appleSub?: string;
  providers: string[];
  hasPassword: boolean;
  hasData: boolean;
}

// 账号模型，rpc 的行为与 0058 的 SQL 函数一致（SQL 本身由 backend/qa/sql/20_*.sql 在本地 Postgres 上测）。
function setup(accounts: Record<string, Account>, opts: { deleteReturnsNull?: boolean } = {}) {
  const fake = installSupabase(new FakeSupabase());
  const state = new Map(Object.entries(accounts));
  fake.rpcHandlers.apple_identity_owner = ({ p_sub }) => ({
    data: [...state.entries()].find(([, a]) => a.appleSub === p_sub)?.[0] ?? null,
    error: null
  });
  fake.rpcHandlers.delete_auth_user_if_empty = ({ p_uid }) => {
    const a = state.get(String(p_uid));
    const empty =
      !!a && !a.hasPassword && !a.hasData && a.providers.includes("apple") && a.providers.every((p) => p === "apple");
    if (!empty) return { data: false, error: null };
    if (opts.deleteReturnsNull) return { data: null, error: null };
    state.delete(String(p_uid));
    return { data: true, error: null };
  };
  fake.rpcHandlers.account_has_data = ({ p_uid }) => ({
    data: state.get(String(p_uid))?.hasData ?? false,
    error: null
  });
  return { fake, state };
}

const CALLER = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const APPLE_SUB = "001234.abcdef0123456789.0042";
const RAW_NONCE = "raw-nonce-7c0a8a3e";

async function appleIdToken(
  overrides: { aud?: string; iss?: string; nonce?: string; expSeconds?: number; key?: KeyLike; kid?: string } = {}
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ nonce: overrides.nonce ?? (await sha256Hex(RAW_NONCE)), nonce_supported: true })
    .setProtectedHeader({ alg: "RS256", kid: overrides.kid ?? "apple-k1" })
    .setIssuer(overrides.iss ?? "https://appleid.apple.com")
    .setAudience(overrides.aud ?? BUNDLE_ID)
    .setSubject(APPLE_SUB)
    .setIssuedAt(now - 60)
    .setExpirationTime(now + (overrides.expSeconds ?? 600))
    .sign(overrides.key ?? appleKey.privateKey);
}

function signedIn(fake: FakeSupabase, user: { id: string; is_anonymous: boolean }) {
  fake.sessions.set("caller-access-token", user);
}

async function call(body: unknown, token = "caller-access-token") {
  const res = await handler(bearer(token, body));
  return { status: res.status, body: await res.json() };
}

Deno.test("rejects an invalid Apple credential with 401 (signature, aud, iss, nonce, expiry)", async () => {
  const { fake } = setup({
    [OWNER]: { appleSub: APPLE_SUB, providers: ["apple"], hasPassword: false, hasData: false }
  });
  signedIn(fake, { id: CALLER, is_anonymous: true });
  const cases: Record<string, string> = {
    "wrong signature": await appleIdToken({ key: attackerKey.privateKey }),
    "wrong audience": await appleIdToken({ aud: "com.example.other" }),
    "wrong issuer": await appleIdToken({ iss: "https://evil.example" }),
    "nonce mismatch": await appleIdToken({ nonce: await sha256Hex("another-nonce") }),
    expired: await appleIdToken({ expSeconds: -120 })
  };
  for (const [label, idToken] of Object.entries(cases)) {
    const r = await call({ idToken, rawNonce: RAW_NONCE });
    assertEquals(r.status, 401, label);
    assertEquals(r.body.ok, false, label);
  }
  assertEquals(
    fake.calls.filter((c) => c.startsWith("rpc:")),
    [],
    "no database call before the Apple token is verified"
  );
  assert(jwksFetches >= 1, "keys come from the (stubbed) Apple JWKS endpoint");
});

Deno.test("rejects a non-anonymous caller with 403 and an unauthenticated one with 401", async () => {
  const { fake } = setup({});
  signedIn(fake, { id: CALLER, is_anonymous: false });
  const idToken = await appleIdToken();
  assertEquals((await call({ idToken, rawNonce: RAW_NONCE })).status, 403);
  assertEquals((await call({ idToken, rawNonce: RAW_NONCE }, "unknown-token")).status, 401);
  const res = await handler(new Request("http://localhost/fn", { method: "POST", body: "{}" }));
  assertEquals(res.status, 401);
  await res.body?.cancel();
  signedIn(fake, { id: CALLER, is_anonymous: true });
  assertEquals((await call({ idToken })).status, 400, "rawNonce is required");
  assertEquals(fake.deletedUsers, []);
});

Deno.test("X is an empty Apple-only account → freed, and X really is deleted", async () => {
  const { fake, state } = setup({
    [CALLER]: { providers: ["anonymous"], hasPassword: false, hasData: true },
    [OWNER]: { appleSub: APPLE_SUB, providers: ["apple"], hasPassword: false, hasData: false }
  });
  signedIn(fake, { id: CALLER, is_anonymous: true });
  const r = await call({ idToken: await appleIdToken(), rawNonce: RAW_NONCE });
  assertEquals(r, { status: 200, body: { ok: true, result: "freed" } });
  assertFalse(state.has(OWNER), "X deleted under lock by delete_auth_user_if_empty");
  assert(state.has(CALLER), "the caller is never deleted here");
  assertEquals(
    fake.rpcArgs.find((c) => c.name === "delete_auth_user_if_empty")?.args,
    { p_uid: OWNER },
    "only X is offered for deletion"
  );
});

Deno.test("without DELETE on auth.users (helper returns NULL) → freed via admin.deleteUser(X)", async () => {
  const { fake } = setup(
    { [OWNER]: { appleSub: APPLE_SUB, providers: ["apple"], hasPassword: false, hasData: false } },
    { deleteReturnsNull: true }
  );
  signedIn(fake, { id: CALLER, is_anonymous: true });
  const r = await call({ idToken: await appleIdToken(), rawNonce: RAW_NONCE });
  assertEquals(r.body.result, "freed");
  assertEquals(fake.deletedUsers, [OWNER]);
});

Deno.test("X has data, caller is empty → caller_empty, nothing deleted", async () => {
  const { fake, state } = setup({
    [CALLER]: { providers: ["anonymous"], hasPassword: false, hasData: false },
    [OWNER]: { appleSub: APPLE_SUB, providers: ["apple"], hasPassword: false, hasData: true }
  });
  signedIn(fake, { id: CALLER, is_anonymous: true });
  const r = await call({ idToken: await appleIdToken(), rawNonce: RAW_NONCE });
  assertEquals(r.body, { ok: true, result: "caller_empty" });
  assert(state.has(OWNER) && state.has(CALLER), "no account deleted");
  assertEquals(fake.deletedUsers, []);
});

Deno.test("both sides have data → both_have_data, nothing deleted", async () => {
  const { fake, state } = setup({
    [CALLER]: { providers: ["anonymous"], hasPassword: false, hasData: true },
    [OWNER]: { appleSub: APPLE_SUB, providers: ["apple"], hasPassword: false, hasData: true }
  });
  signedIn(fake, { id: CALLER, is_anonymous: true });
  const r = await call({ idToken: await appleIdToken(), rawNonce: RAW_NONCE });
  assertEquals(r.body, { ok: true, result: "both_have_data" });
  assert(state.has(OWNER) && state.has(CALLER));
  assertEquals(fake.deletedUsers, []);
});

Deno.test("X with an email identity (or a password) counts as having data", async () => {
  for (const owner of [
    { appleSub: APPLE_SUB, providers: ["apple", "email"], hasPassword: false, hasData: false },
    { appleSub: APPLE_SUB, providers: ["apple"], hasPassword: true, hasData: false }
  ]) {
    const { fake, state } = setup({
      [CALLER]: { providers: ["anonymous"], hasPassword: false, hasData: true },
      [OWNER]: owner
    });
    signedIn(fake, { id: CALLER, is_anonymous: true });
    const r = await call({ idToken: await appleIdToken(), rawNonce: RAW_NONCE });
    assertEquals(r.body.result, "both_have_data");
    assert(state.has(OWNER), "X kept");
    assertEquals(fake.deletedUsers, []);
  }
});

Deno.test("no owner, or the owner is the caller → no_conflict", async () => {
  let { fake } = setup({});
  signedIn(fake, { id: CALLER, is_anonymous: true });
  assertEquals((await call({ idToken: await appleIdToken(), rawNonce: RAW_NONCE })).body.result, "no_conflict");
  ({ fake } = setup({ [CALLER]: { appleSub: APPLE_SUB, providers: ["apple"], hasPassword: false, hasData: true } }));
  signedIn(fake, { id: CALLER, is_anonymous: true });
  assertEquals((await call({ idToken: await appleIdToken(), rawNonce: RAW_NONCE })).body.result, "no_conflict");
  assertFalse(fake.calls.includes("rpc:delete_auth_user_if_empty"));
});

Deno.test("logs carry only the result type: no token, nonce, Apple sub or user id", async () => {
  const logs = captureConsole();
  const idToken = await appleIdToken();
  try {
    for (const owner of [
      { appleSub: APPLE_SUB, providers: ["apple"], hasPassword: false, hasData: false },
      { appleSub: APPLE_SUB, providers: ["apple"], hasPassword: false, hasData: true }
    ]) {
      const { fake } = setup({ [CALLER]: { providers: [], hasPassword: false, hasData: true }, [OWNER]: owner });
      signedIn(fake, { id: CALLER, is_anonymous: true });
      await call({ idToken, rawNonce: RAW_NONCE });
      await call({ idToken: await appleIdToken({ aud: "x" }), rawNonce: RAW_NONCE });
    }
  } finally {
    logs.restore();
  }
  const text = logs.text();
  assert(text.includes("freed") && text.includes("both_have_data"), "results are logged");
  for (const secret of [idToken, RAW_NONCE, APPLE_SUB, CALLER, OWNER, "caller-access-token"]) {
    assertFalse(text.includes(secret), `log must not contain ${secret.slice(0, 12)}…`);
  }
});

Deno.test({
  name: "cleanup: restore fetch",
  fn: () => fetchStub.restore(),
  sanitizeOps: false,
  sanitizeResources: false
});

// delete-account：Apple 授权撤销（尽力而为）+ 共享清理模块抽出之后原有行为不变。
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { exportPKCS8, generateKeyPair, jwtVerify, UnsecuredJWT } from "https://esm.sh/jose@5.10.0";
import { drainStorageCleanupQueue } from "../_shared/account-cleanup.ts";
import {
  bearer,
  captureConsole,
  FakeSupabase,
  installSupabase,
  loadFunction,
  type RecordedRequest,
  stubFetch,
  TEST_ENV
} from "./support.ts";

const BUNDLE_ID = "cd.cc.relaycare";
const TEAM_ID = "TEAMID1234";
const KEY_ID = "SIWAKEY123";
const UID = "33333333-3333-4333-8333-333333333333";
const APPLE_SUB = "001234.feedfacecafe.0007";
const AUTH_CODE = "c0de.authorization.code";
const APPLE_REFRESH = "r.apple-refresh-token";

// 每次运行现生成一把 ES256 私钥（不是任何真实的 SIWA 私钥），写进环境变量时把换行写成字面量 \n，
// 顺带覆盖 secrets 里常见的转义写法。
const siwaKey = await generateKeyPair("ES256", { extractable: true });
const siwaPem = (await exportPKCS8(siwaKey.privateKey)).replace(/\n/g, "\\n");

const handler = await loadFunction(new URL("../delete-account/index.ts", import.meta.url).href, {
  ...TEST_ENV,
  APPLE_BUNDLE_ID: BUNDLE_ID,
  APPLE_TEAM_ID: TEAM_ID,
  APPLE_SIWA_KEY_ID: KEY_ID,
  APPLE_SIWA_PRIVATE_KEY: siwaPem
});

function appleIdTokenFromTokenEndpoint(sub: string): string {
  // /auth/token 直接（TLS）返回的 id_token：函数只核对 iss / aud / sub，不验签。
  return new UnsecuredJWT({ sub })
    .setIssuer("https://appleid.apple.com")
    .setAudience(BUNDLE_ID)
    .setIssuedAt()
    .setExpirationTime("10m")
    .encode();
}

function setup(user: { identities?: { provider: string; id?: string; identity_data?: Record<string, unknown> }[] }) {
  const fake = installSupabase(new FakeSupabase());
  fake.sessions.set("user-token", { id: UID, is_anonymous: false, ...user });
  fake.rpcHandlers.delete_account_data = () => ({ data: null, error: null });
  fake.tables.account_deletion_storage_cleanup = [{ user_id: UID, household_id: "hh-1" }];
  fake.storage = new Set(["hh-1/a.pdf", "hh-1/b.jpg", "hh-2/keep.pdf"]);
  return fake;
}

const appleUser = { identities: [{ provider: "apple", id: APPLE_SUB, identity_data: { sub: APPLE_SUB } }] };

function appleEndpoints(opts: { tokenStatus?: number; revokeStatus?: number; sub?: string } = {}) {
  return stubFetch((req: RecordedRequest) => {
    if (req.url === "https://appleid.apple.com/auth/token") {
      if (opts.tokenStatus && opts.tokenStatus !== 200)
        return new Response('{"error":"invalid_grant"}', { status: opts.tokenStatus });
      return Response.json({
        access_token: "a.apple-access-token",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: APPLE_REFRESH,
        id_token: appleIdTokenFromTokenEndpoint(opts.sub ?? APPLE_SUB)
      });
    }
    if (req.url === "https://appleid.apple.com/auth/revoke")
      return new Response("", { status: opts.revokeStatus ?? 200 });
    return new Response("unexpected", { status: 599 });
  });
}

async function deleteAccount(body?: unknown) {
  const res = await handler(bearer("user-token", body));
  return { status: res.status, body: await res.json() };
}

function form(req: RecordedRequest): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(req.body));
}

Deno.test("Apple revoke: client_secret header/claims, token exchange and revoke request format", async () => {
  const fake = setup(appleUser);
  const apple = appleEndpoints();
  try {
    assertEquals(await deleteAccount({ appleAuthorizationCode: AUTH_CODE }), { status: 200, body: { ok: true } });
  } finally {
    apple.restore();
  }
  assertEquals(
    apple.requests.map((r) => r.url),
    ["https://appleid.apple.com/auth/token", "https://appleid.apple.com/auth/revoke"]
  );
  const [tokenReq, revokeReq] = apple.requests;
  for (const r of apple.requests) {
    assertEquals(r.method, "POST");
    assertEquals(r.headers.get("content-type"), "application/x-www-form-urlencoded");
  }
  const tokenForm = form(tokenReq);
  assertEquals(tokenForm.client_id, BUNDLE_ID);
  assertEquals(tokenForm.code, AUTH_CODE);
  assertEquals(tokenForm.grant_type, "authorization_code");

  // client_secret：ES256，kid = Key ID，iss = Team ID，sub = bundle id，aud = Apple，有效期 ≤ 5 分钟，签名可用公钥验证。
  const [h, p] = tokenForm.client_secret.split(".");
  const header = JSON.parse(atob(h.replace(/-/g, "+").replace(/_/g, "/")));
  const claims = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
  assertEquals(header, { alg: "ES256", kid: KEY_ID });
  assertEquals(claims.iss, TEAM_ID);
  assertEquals(claims.sub, BUNDLE_ID);
  assertEquals(claims.aud, "https://appleid.apple.com");
  assert(claims.exp - claims.iat <= 300 && claims.exp > Math.floor(Date.now() / 1000), "short-lived client_secret");
  await jwtVerify(tokenForm.client_secret, siwaKey.publicKey, { algorithms: ["ES256"] });

  assertEquals(form(revokeReq), {
    client_id: BUNDLE_ID,
    client_secret: tokenForm.client_secret,
    token: APPLE_REFRESH,
    token_type_hint: "refresh_token"
  });
  assertEquals(fake.deletedUsers, [UID], "account deleted");
});

Deno.test("Apple revoke returns 500 → account is still deleted", async () => {
  const fake = setup(appleUser);
  const apple = appleEndpoints({ revokeStatus: 500 });
  const logs = captureConsole();
  try {
    assertEquals((await deleteAccount({ appleAuthorizationCode: AUTH_CODE })).status, 200);
  } finally {
    logs.restore();
    apple.restore();
  }
  assertEquals(apple.requests.length, 2);
  assertEquals(fake.deletedUsers, [UID]);
  assert(logs.text().includes("failed_revoke"));
});

Deno.test(
  "token exchange fails, or the code belongs to another Apple ID → no revoke, account still deleted",
  async () => {
    for (const opts of [{ tokenStatus: 400 }, { sub: "001999.someone-else.0001" }]) {
      const fake = setup(appleUser);
      const apple = appleEndpoints(opts);
      const logs = captureConsole();
      try {
        assertEquals((await deleteAccount({ appleAuthorizationCode: AUTH_CODE })).status, 200);
      } finally {
        logs.restore();
        apple.restore();
      }
      assertEquals(
        apple.requests.map((r) => r.url),
        ["https://appleid.apple.com/auth/token"],
        "revoke not called"
      );
      assertEquals(fake.deletedUsers, [UID]);
    }
  }
);

Deno.test("no code, or a user without an Apple identity → no Apple call, deleted as before", async () => {
  type Identity = { provider: string; id?: string; identity_data?: Record<string, unknown> };
  const cases: [{ identities: Identity[] }, unknown][] = [
    [appleUser, undefined],
    [appleUser, {}],
    [{ identities: [{ provider: "anonymous" }] }, { appleAuthorizationCode: AUTH_CODE }]
  ];
  for (const [user, body] of cases) {
    const fake = setup(user);
    const apple = appleEndpoints();
    try {
      assertEquals(await deleteAccount(body), { status: 200, body: { ok: true } });
    } finally {
      apple.restore();
    }
    assertEquals(apple.requests, []);
    assertEquals(fake.deletedUsers, [UID]);
  }
});

Deno.test("existing behaviour: data → storage queue → clear queue → delete auth user, in that order", async () => {
  const fake = setup({});
  assertEquals((await deleteAccount()).status, 200);
  assertEquals(fake.calls, [
    "rpc:delete_account_data",
    "select:account_deletion_storage_cleanup",
    "storage.list",
    "storage.remove",
    "delete:account_deletion_storage_cleanup",
    `deleteUser:${UID}`
  ]);
  assertEquals(fake.removedObjects.sort(), ["hh-1/a.pdf", "hh-1/b.jpg"]);
  assertEquals([...fake.storage], ["hh-2/keep.pdf"], "other households' files untouched");
  assertEquals(fake.tables.account_deletion_storage_cleanup, []);
  assertEquals(fake.clientKeys, [TEST_ENV.SUPABASE_ANON_KEY, TEST_ENV.SUPABASE_SERVICE_ROLE_KEY]);
});

Deno.test("existing behaviour: a storage or queue failure keeps the auth user for a safe retry", async () => {
  for (const failure of [
    "storage.remove",
    "select:account_deletion_storage_cleanup",
    "delete:account_deletion_storage_cleanup"
  ]) {
    const fake = setup({});
    fake.failures.set(failure, { message: "boom" });
    const logs = captureConsole();
    try {
      const r = await deleteAccount();
      assertEquals(r.status, 500, failure);
      assertEquals(r.body.ok, false);
    } finally {
      logs.restore();
    }
    assertEquals(fake.deletedUsers, [], `${failure}: auth user kept`);
  }
  const fake = setup({});
  fake.sessions.clear();
  assertEquals((await deleteAccount()).status, 401, "invalid session");
});

Deno.test("shared drainStorageCleanupQueue removes exactly what delete-account removes", async () => {
  const seed = () => {
    const fake = installSupabase(new FakeSupabase());
    fake.tables.account_deletion_storage_cleanup = [
      { user_id: UID, household_id: "hh-1" },
      { user_id: UID, household_id: "hh-3" },
      { user_id: "someone-else", household_id: "hh-2" }
    ];
    const many = Array.from({ length: 450 }, (_, i) => `hh-3/doc-${String(i).padStart(4, "0")}.pdf`);
    fake.storage = new Set(["hh-1/a.pdf", "hh-2/keep.pdf", ...many]);
    return fake;
  };
  const viaFunction = seed();
  viaFunction.sessions.set("user-token", { id: UID });
  viaFunction.rpcHandlers.delete_account_data = () => ({ data: null, error: null });
  assertEquals((await deleteAccount()).status, 200);

  const viaShared = seed();
  const admin = viaShared.client("", "service");
  assertEquals(await drainStorageCleanupQueue(admin, UID), 2);

  assertEquals(viaShared.removedObjects.sort(), viaFunction.removedObjects.sort());
  assertEquals(viaShared.removedObjects.length, 451, "pagination collects all 450 + 1 files before deleting");
  assertEquals([...viaShared.storage], ["hh-2/keep.pdf"]);
  assertEquals(viaShared.tables.account_deletion_storage_cleanup, viaFunction.tables.account_deletion_storage_cleanup);
});

Deno.test("logs never contain the authorization code, Apple tokens, the Apple sub or the user id", async () => {
  setup(appleUser);
  const apple = appleEndpoints({ revokeStatus: 500 });
  const logs = captureConsole();
  try {
    await deleteAccount({ appleAuthorizationCode: AUTH_CODE });
  } finally {
    logs.restore();
    apple.restore();
  }
  const text = logs.text();
  for (const secret of [AUTH_CODE, APPLE_REFRESH, "a.apple-access-token", APPLE_SUB, UID, KEY_ID]) {
    assertFalse(text.includes(secret), `log must not contain ${secret}`);
  }
});

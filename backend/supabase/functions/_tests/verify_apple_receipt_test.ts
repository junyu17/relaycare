// verify-apple-receipt：转让之后付款人（照护者）可以给已覆盖的家庭恢复购买；未覆盖的家庭、别人的订阅、
// 非协调人首次购买都被拒。已覆盖家庭的恢复走 sync_subscription_by_transaction（按覆盖范围逐户重算），
// 不走 register_apple_subscription（它只认最初登记的那一户，另一户会报 already linked）。
// StoreKit JWS 验签由 stubs/apple-jws.ts 替身（证书链不是这里要测的）。
import { assert, assertEquals } from "jsr:@std/assert@1";
import { registerFakeJws } from "./stubs/apple-jws.ts";
import { bearer, captureConsole, FakeSupabase, installSupabase, loadFunction, TEST_ENV } from "./support.ts";

const BUNDLE_ID = "cd.cc.relaycare";
const handler = await loadFunction(new URL("../verify-apple-receipt/index.ts", import.meta.url).href, {
  ...TEST_ENV,
  APPLE_BUNDLE_ID: BUNDLE_ID,
  APPLE_ACCEPTED_ENVIRONMENTS: "Sandbox,Production"
});

const PAYER = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";
const H_COVERED = "hhhhhhhh-0000-4000-8000-00000000000a";
const H_OTHER = "hhhhhhhh-0000-4000-8000-00000000000b";
const SKU = "TaskKin.care.pro.mon";

function transaction(appAccountToken: string, overrides: Record<string, unknown> = {}) {
  return registerFakeJws({
    bundleId: BUNDLE_ID,
    environment: "Sandbox",
    productId: SKU,
    transactionId: "tx-2",
    originalTransactionId: "otx-1",
    signedDate: Date.now() - 60_000,
    expiresDate: Date.now() + 20 * 24 * 3600 * 1000,
    appAccountToken,
    ...overrides
  });
}

// 场景：PAYER 在 H_COVERED 买了 Plus，然后把协调人转让给别人，自己是 caregiver；
// 他在 H_OTHER 也是 caregiver，但订阅没有覆盖 H_OTHER。
function setup(opts: { payerRole?: string; ownerToken?: string | null } = {}) {
  const fake = installSupabase(new FakeSupabase());
  fake.sessions.set("payer-token", { id: PAYER, is_anonymous: false });
  fake.tables.members = [
    {
      id: "m-payer-a",
      household_id: H_COVERED,
      user_id: PAYER,
      role: opts.payerRole ?? "caregiver",
      invite_status: "active"
    },
    { id: "m-payer-b", household_id: H_OTHER, user_id: PAYER, role: "caregiver", invite_status: "active" }
  ];
  fake.tables.subscriptions = [
    {
      id: "sub-1",
      original_transaction_id: "otx-1",
      status: "active",
      owner_user_id: PAYER,
      owner_app_account_token: opts.ownerToken === undefined ? PAYER : opts.ownerToken,
      household_id: H_COVERED
    }
  ];
  fake.tables.subscription_households = [{ subscription_id: "sub-1", household_id: H_COVERED }];
  fake.rpcHandlers.register_apple_subscription = () => ({ data: null, error: null });
  fake.rpcHandlers.sync_subscription_by_transaction = () => ({ data: null, error: null });
  return fake;
}

async function verify(body: Record<string, unknown>) {
  const logs = captureConsole();
  try {
    const res = await handler(bearer("payer-token", body));
    return { status: res.status, body: await res.json() };
  } finally {
    logs.restore();
  }
}

Deno.test("caregiver payer restores Plus for a household his subscription already covers", async () => {
  const fake = setup();
  const r = await verify({
    productId: SKU,
    purchaseToken: transaction(PAYER),
    householdId: H_COVERED,
    mode: "restore"
  });
  assertEquals(r.status, 200, JSON.stringify(r.body));
  assertEquals(r.body.ok, true);
  // 照护者从不 register（不新增覆盖、不改归属），只按已有覆盖范围续上。
  assert(!fake.calls.includes("rpc:register_apple_subscription"), "a caregiver never registers");
  const sync = fake.rpcArgs.find((c) => c.name === "sync_subscription_by_transaction");
  assertEquals(sync?.args.p_original_transaction_id, "otx-1");
  assertEquals(sync?.args.p_plan, "monthly");
  assertEquals(sync?.args.p_status, "active");
  assertEquals(sync?.args.p_last_transaction_id, "tx-2");
  assertEquals(typeof sync?.args.p_expires_at, "string");
});

Deno.test("coordinator restore in a second covered household refreshes it instead of failing in register", async () => {
  // 评审 minor：订阅最初登记在 H_COVERED，又经 create_household 覆盖了 H_OTHER。
  // register_apple_subscription(H_OTHER) 会报 "already linked to another household"，这里不能再走它。
  const fake = setup({ payerRole: "coordinator" });
  fake.tables.members[1].role = "coordinator";
  fake.tables.subscription_households.push({ subscription_id: "sub-1", household_id: H_OTHER });
  fake.rpcHandlers.register_apple_subscription = () => ({
    data: null,
    error: { message: "This Apple subscription is already linked to another household" }
  });
  const r = await verify({ productId: SKU, purchaseToken: transaction(PAYER), householdId: H_OTHER, mode: "restore" });
  assertEquals(r.status, 200, JSON.stringify(r.body));
  assert(!fake.calls.includes("rpc:register_apple_subscription"));
  assert(fake.calls.includes("rpc:sync_subscription_by_transaction"));
});

Deno.test("coordinator restore in the household the subscription was registered to still uses register", async () => {
  const fake = setup({ payerRole: "coordinator" });
  const r = await verify({
    productId: SKU,
    purchaseToken: transaction(PAYER),
    householdId: H_COVERED,
    mode: "restore"
  });
  assertEquals(r.status, 200, JSON.stringify(r.body));
  const register = fake.rpcArgs.find((c) => c.name === "register_apple_subscription");
  assertEquals(register?.args.p_household_id, H_COVERED);
  assertEquals(register?.args.p_owner_user_id, PAYER);
  assertEquals(register?.args.p_owner_member_id, "m-payer-a");
  assert(!fake.calls.includes("rpc:sync_subscription_by_transaction"));
});

Deno.test("a failed covered refresh is reported, not swallowed", async () => {
  const fake = setup();
  fake.rpcHandlers.sync_subscription_by_transaction = () => ({ data: null, error: { message: "boom" } });
  const r = await verify({
    productId: SKU,
    purchaseToken: transaction(PAYER),
    householdId: H_COVERED,
    mode: "restore"
  });
  assertEquals(r.status, 500);
  assertEquals(r.body.code, "SUBSCRIPTION_REGISTER_FAILED");
});

Deno.test("caregiver restore for a household the subscription does not cover → COORDINATOR_REQUIRED", async () => {
  const fake = setup();
  const r = await verify({ productId: SKU, purchaseToken: transaction(PAYER), householdId: H_OTHER, mode: "restore" });
  assertEquals(r.status, 403);
  assertEquals(r.body.code, "COORDINATOR_REQUIRED");
  assert(!fake.calls.includes("rpc:register_apple_subscription"), "coverage is not extended");
  assert(!fake.calls.includes("rpc:sync_subscription_by_transaction"), "nothing is refreshed");
});

Deno.test("caregiver first purchase → COORDINATOR_REQUIRED before the JWS is even verified", async () => {
  const fake = setup();
  const r = await verify({ productId: SKU, purchaseToken: "not-registered-jws", householdId: H_COVERED });
  assertEquals(r.status, 403);
  assertEquals(r.body.code, "COORDINATOR_REQUIRED");
  assertEquals(fake.calls, ["select:members"]);
});

Deno.test("caregiver cannot restore a subscription whose stored owner token is someone else", async () => {
  const fake = setup({ ownerToken: OTHER });
  const r = await verify({
    productId: SKU,
    purchaseToken: transaction(PAYER),
    householdId: H_COVERED,
    mode: "restore"
  });
  assertEquals(r.status, 403);
  assertEquals(r.body.code, "ACCOUNT_TOKEN_MISMATCH");
  assert(String(r.body.error).includes("(Apple or email)"), "message names both sign-in methods");
  assert(!fake.calls.includes("rpc:register_apple_subscription"));
});

Deno.test("caregiver restore of a legacy row without a stored owner token is refused", async () => {
  const fake = setup({ ownerToken: null });
  const r = await verify({
    productId: SKU,
    purchaseToken: transaction(PAYER),
    householdId: H_COVERED,
    mode: "restore"
  });
  assertEquals(r.status, 403);
  assertEquals(r.body.code, "COORDINATOR_REQUIRED");
  assert(!fake.calls.includes("rpc:register_apple_subscription"));
});

Deno.test("coordinator purchase still works and an appAccountToken mismatch is still rejected", async () => {
  let fake = setup({ payerRole: "coordinator" });
  fake.tables.subscriptions = [];
  fake.tables.subscription_households = [];
  let r = await verify({
    productId: SKU,
    purchaseToken: transaction(PAYER, { originalTransactionId: "otx-new" }),
    householdId: H_COVERED
  });
  assertEquals(r.status, 200, JSON.stringify(r.body));
  assert(fake.calls.includes("rpc:register_apple_subscription"));

  fake = setup({ payerRole: "coordinator" });
  r = await verify({ productId: SKU, purchaseToken: transaction(OTHER), householdId: H_COVERED, mode: "restore" });
  assertEquals(r.status, 403);
  assertEquals(r.body.code, "ACCOUNT_TOKEN_MISMATCH");
});

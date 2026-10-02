// purge-abandoned-anonymous：只认 CRON_SECRET；对每个候选依次「锁内复查删数据 → Storage → 删 auth 用户」；
// 单个失败不影响后面的账号；单用户模式；日志只有数量。
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { captureConsole, FakeSupabase, installSupabase, loadFunction, TEST_ENV } from "./support.ts";

const CRON_SECRET = "test-cron-secret-not-real";
const handler = await loadFunction(new URL("../purge-abandoned-anonymous/index.ts", import.meta.url).href, {
  ...TEST_ENV,
  CRON_SECRET
});

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const D = "dddddddd-0000-4000-8000-000000000004";

function request(secret: string | null, body?: unknown, method = "POST"): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret !== null) headers["x-cron-secret"] = secret;
  return new Request("http://localhost/purge", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function setup(candidates: { user_id: string; kind: string }[], purgeKinds: Record<string, string | null>) {
  const fake = installSupabase(new FakeSupabase());
  fake.rpcHandlers.anonymous_retention_candidates = () => ({ data: candidates, error: null });
  fake.rpcHandlers.purge_anonymous_account_data = ({ p_uid }) => ({
    data: purgeKinds[String(p_uid)] ?? null,
    error: null
  });
  fake.tables.account_deletion_storage_cleanup = [
    { user_id: A, household_id: "hh-a" },
    { user_id: C, household_id: "hh-c" }
  ];
  fake.storage = new Set(["hh-a/a.pdf", "hh-c/c.pdf"]);
  return fake;
}

async function run(req: Request) {
  const logs = captureConsole();
  try {
    const res = await handler(req);
    return { status: res.status, body: await res.json(), logs: logs.text() };
  } finally {
    logs.restore();
  }
}

Deno.test("wrong or missing secret → 401 and nothing is touched", async () => {
  const fake = setup([{ user_id: A, kind: "solo" }], { [A]: "solo" });
  assertEquals((await run(request(null))).status, 401);
  assertEquals((await run(request("wrong"))).status, 401);
  assertEquals((await run(request(CRON_SECRET.slice(0, -1)))).status, 401);
  assertEquals((await run(request(CRON_SECRET, undefined, "GET"))).status, 405);
  assertEquals(fake.calls, []);
});

Deno.test(
  "each candidate: recheck+delete data → storage → delete auth user; one failure does not stop the rest",
  async () => {
    const fake = setup(
      [
        { user_id: A, kind: "solo" },
        { user_id: B, kind: "empty" },
        { user_id: C, kind: "solo" },
        { user_id: D, kind: "empty" }
      ],
      // B 在列出之后有人加入：复查返回 NULL，跳过；C 的 Storage 删除失败。
      { [A]: "solo", [B]: null, [C]: "solo", [D]: "empty" }
    );
    // 只让 C 的 Storage 删除失败：hh-a 里没有文件（不会调 remove），hh-c 有一个文件。
    fake.storage = new Set(["hh-c/c.pdf"]);
    fake.failures.set("storage.remove", { message: "storage down" });

    const r = await run(request(CRON_SECRET));
    assertEquals(r.status, 200);
    assertEquals(r.body, {
      ok: false,
      candidates: 4,
      purged: { empty: 1, solo: 1 },
      skipped: 1,
      failed: 1,
      failedSteps: { storage: 1 }
    });
    assertEquals(fake.deletedUsers, [A, D], "A and D deleted; B skipped; C kept for the next run");
    assertEquals(
      fake.rpcArgs.filter((c) => c.name === "purge_anonymous_account_data").map((c) => c.args),
      [A, B, C, D].map((p_uid) => ({ p_uid, p_single_user: false }))
    );
    assertEquals(fake.rpcArgs.find((c) => c.name === "anonymous_retention_candidates")?.args, {
      p_limit: 50,
      p_user_id: null
    });
    // 每个账号的顺序：purge → 读队列 → (Storage) → 清队列 → deleteUser
    const aCalls = fake.calls.slice(
      fake.calls.indexOf("rpc:purge_anonymous_account_data"),
      fake.calls.indexOf(`deleteUser:${A}`) + 1
    );
    assertEquals(aCalls, [
      "rpc:purge_anonymous_account_data",
      "select:account_deletion_storage_cleanup",
      "storage.list",
      "delete:account_deletion_storage_cleanup",
      `deleteUser:${A}`
    ]);
    assertEquals(
      fake.tables.account_deletion_storage_cleanup,
      [{ user_id: C, household_id: "hh-c" }],
      "C's queue row survives for the retry"
    );
  }
);

Deno.test("storage files of a purged account are removed before the auth user is deleted", async () => {
  const fake = setup([{ user_id: A, kind: "solo" }], { [A]: "solo" });
  const r = await run(request(CRON_SECRET));
  assertEquals(r.body.purged, { empty: 0, solo: 1 });
  assertEquals(fake.removedObjects, ["hh-a/a.pdf"]);
  assert(fake.calls.indexOf("storage.remove") < fake.calls.indexOf(`deleteUser:${A}`));
});

Deno.test("deleteUser failure is counted and the next account still runs", async () => {
  const fake = setup(
    [
      { user_id: A, kind: "solo" },
      { user_id: D, kind: "empty" }
    ],
    { [A]: "solo", [D]: "empty" }
  );
  fake.failures.set("deleteUser", { message: "gotrue down" });
  const r = await run(request(CRON_SECRET));
  assertEquals(r.body.failed, 2);
  assertEquals(r.body.failedSteps, { "admin.deleteUser": 2 });
  assertEquals(
    fake.calls.filter((c) => c.startsWith("deleteUser:")),
    [`deleteUser:${A}`, `deleteUser:${D}`]
  );
});

Deno.test("single-user mode passes the uid and the 14-day flag; rejects a non-uuid", async () => {
  const fake = setup([{ user_id: A, kind: "solo" }], { [A]: "solo" });
  const r = await run(request(CRON_SECRET, { userId: A }));
  assertEquals(r.body.purged.solo, 1);
  assertEquals(fake.rpcArgs[0], { name: "anonymous_retention_candidates", args: { p_limit: 50, p_user_id: A } });
  assertEquals(fake.rpcArgs[1], { name: "purge_anonymous_account_data", args: { p_uid: A, p_single_user: true } });
  assertEquals((await run(request(CRON_SECRET, { userId: "not-a-uuid" }))).status, 400);
  assertEquals(
    (
      await run(
        new Request("http://localhost/purge", { method: "POST", headers: { "x-cron-secret": CRON_SECRET }, body: "{" })
      )
    ).status,
    400
  );
});

Deno.test("logs carry counts only: no user id, household id or secret", async () => {
  const fake = setup(
    [
      { user_id: A, kind: "solo" },
      { user_id: C, kind: "solo" }
    ],
    { [A]: "solo", [C]: "solo" }
  );
  fake.failures.set("storage.list", { message: "list failed for hh-c" });
  const r = await run(request(CRON_SECRET));
  assert(r.logs.includes('"candidates":2'));
  for (const secret of [A, C, "hh-a", "hh-c", CRON_SECRET]) {
    assertFalse(r.logs.includes(secret), `log must not contain ${secret}`);
  }
});

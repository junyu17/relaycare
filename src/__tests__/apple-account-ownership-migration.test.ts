import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(__dirname, "../../backend/supabase/migrations/0055_persist_apple_account_identity.sql"),
  "utf8"
);
const verifier = readFileSync(
  join(__dirname, "../../backend/supabase/functions/verify-apple-receipt/index.ts"),
  "utf8"
);

describe("durable Apple subscription account ownership", () => {
  it("stores a non-device account token that survives auth-user deletion", () => {
    expect(migration).toContain("add column if not exists owner_app_account_token uuid");
    expect(migration).toContain("owner_app_account_token = owner_user_id");
    expect(migration).toContain("owner_app_account_token = coalesce(owner_app_account_token, p_owner_user_id)");
  });

  it("does not allow an existing subscription to move to another login account", () => {
    expect(migration).toContain("v_sub.owner_app_account_token <> p_owner_user_id");
    expect(verifier).toContain("appAccountToken !== userData.user.id");
    expect(verifier).not.toContain("reclaim_orphan");
  });

  it("keeps the registration RPC service-role only", () => {
    expect(migration).toMatch(/from public, anon, authenticated/);
    expect(migration).toMatch(/to service_role/);
  });
});

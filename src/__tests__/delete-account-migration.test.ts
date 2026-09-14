import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 静态回归守卫：delete_account_data 不得走 members 硬删路径（0011 的 Apple Review bug），
// 必须匿名化 + 软删除以维持 tasks/documents/audit 的 restrictive FK 引用完整。
// 配套可运行证明：backend/qa/delete_account_regression.sql（事务内执行，无需 secret）。

const MIGRATIONS_DIR = join(__dirname, "../../backend/supabase/migrations");

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function readMigration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), "utf8");
}

const DELETE_ACCOUNT_MIGRATION = migrationFiles().find((name) => name.startsWith("0053_"));

describe("delete_account_data migration (0053, Apple Review 5.1.1)", () => {
  it("migration 0053 exists", () => {
    expect(DELETE_ACCOUNT_MIGRATION).toBe("0053_rewrite_delete_account_data.sql");
  });

  it("does not hard-delete members rows (restrictive FK safety)", () => {
    const sql = readMigration(DELETE_ACCOUNT_MIGRATION!);
    expect(sql).toContain("create or replace function public.delete_account_data");
    // 0011 的错误路径是直接 delete members；0053 必须改为更新行。
    expect(sql).not.toMatch(/delete\s+from\s+public\.members/);
    expect(sql).toMatch(/invite_status\s*=\s*'removed'/);
  });

  it("anonymizes the member placeholder and disconnects auth linkage", () => {
    const sql = readMigration(DELETE_ACCOUNT_MIGRATION!);
    expect(sql).toMatch(/user_id\s*=\s*null/);
    expect(sql).toMatch(/'Deleted member'/);
    expect(sql).toContain("delete from public.notification_preferences");
    expect(sql).toContain("update public.audit_events");
    expect(sql).toContain("update public.role_notifications");
    expect(sql).toMatch(/timezone\s*=\s*'UTC'/);
  });

  it("still cascades coordinated households", () => {
    const sql = readMigration(DELETE_ACCOUNT_MIGRATION!);
    expect(sql).toMatch(/delete\s+from\s+public\.households/);
    expect(sql).toMatch(/role\s*=\s*'coordinator'/);
  });

  it("persists coordinated household ids for retryable storage cleanup", () => {
    const sql = readMigration(DELETE_ACCOUNT_MIGRATION!);
    expect(sql).toContain("create table if not exists public.account_deletion_storage_cleanup");
    expect(sql).toContain("insert into public.account_deletion_storage_cleanup");
    expect(sql).toContain("on conflict (user_id, household_id) do nothing");
  });

  it("grants execution only to service_role", () => {
    const sql = readMigration(DELETE_ACCOUNT_MIGRATION!);
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.delete_account_data\(uuid\)\s+from\s+public/);
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.delete_account_data\(uuid\)\s+from\s+authenticated/);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.delete_account_data\(uuid\)\s+to\s+service_role/);
  });
});

describe("delete-account Edge Function storage cleanup", () => {
  it("cleans storage for coordinated households before deleting the auth user", () => {
    const fn = readFileSync(join(__dirname, "../../backend/supabase/functions/delete-account/index.ts"), "utf8");
    expect(fn).toContain("removeStoragePrefix");
    expect(fn).toContain('from("account_deletion_storage_cleanup")');
    expect(fn).toContain("cleanupReadError");
    expect(fn).toContain("cleanupDeleteError");
    expect(fn).toContain("auth.admin.deleteUser");
  });
});

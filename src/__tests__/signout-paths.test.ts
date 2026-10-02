// 源码断言：退出只有 AuthContext 一个出口；退出家庭、解散家庭、被移除之后不登出（方案 B 评审第 2 条）。
/// <reference types="node" />
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");
const app = readFileSync(join(SRC, "App.tsx"), "utf8");
const authScreen = readFileSync(join(SRC, "auth/AuthScreen.tsx"), "utf8");
const authContext = readFileSync(join(SRC, "auth/AuthContext.tsx"), "utf8");

function segmentAfter(source: string, marker: string, length: number): string {
  const start = source.indexOf(marker);
  expect(start, `marker not found: ${marker}`).toBeGreaterThanOrEqual(0);
  return source.slice(start, start + length);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("sign-out paths", () => {
  it("leaving or dissolving a household refreshes households instead of signing out", () => {
    expect(app).not.toContain(".then(() => cloud.onSignOut())");
    expect(app).not.toContain("onSignOut: signOut");
    const leave = segmentAfter(app, "leaveHousehold(cloud.householdId)", 200);
    expect(leave).toContain("recoverFromMembershipLoss()");
    expect(leave).not.toMatch(/signOut/i);
    const dissolve = segmentAfter(app, "dissolveHousehold()\n", 200);
    expect(dissolve).toContain("recoverFromMembershipLoss()");
    expect(dissolve).not.toMatch(/signOut/i);
  });

  it("the removed / dissolved notification callback never signs out", () => {
    const start = app.indexOf("subscribeUserNotifications(userId, (n) => {");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = app.indexOf("ch.unsubscribe();", start);
    const callback = app.slice(start, end);
    expect(callback).not.toMatch(/signOut\s*\(/);
    expect(callback).toContain("recoverFromMembershipLoss()");
  });

  it("no screen hands the raw signOut to a button (anonymous sessions must confirm first)", () => {
    expect(app).not.toMatch(/onPress=\{(cloud\.onSignOut|signOut)\}/);
    expect(authScreen).not.toMatch(/onPress=\{signOut\}/);
    expect(authScreen).toContain("promptSignOut(");
  });

  it("only AuthContext calls supabase.auth.signOut", () => {
    for (const file of sourceFiles(SRC)) {
      if (file.endsWith(join("auth", "AuthContext.tsx"))) continue;
      expect(readFileSync(file, "utf8"), file).not.toContain("auth.signOut(");
    }
    expect(authContext).toContain("supabase.auth.signOut(");
  });

  it("never calls signUp while holding an anonymous session", () => {
    const signUp = segmentAfter(authContext, "const signUp = async", 400);
    expect(signUp.indexOf("isAnonymousUser(")).toBeGreaterThanOrEqual(0);
    expect(signUp.indexOf("isAnonymousUser(")).toBeLessThan(signUp.indexOf("supabase.auth.signUp("));
  });

  it("every path that would create a new identity first tries the Keychain anchor (review minor)", () => {
    for (const marker of ["const startAnonymously = async", "const joinByCode = async"]) {
      const body = segmentAfter(authContext, marker, 900);
      const restore = body.indexOf("restoreBeforeNewIdentity(");
      expect(restore, marker).toBeGreaterThanOrEqual(0);
      expect(restore, marker).toBeLessThan(body.indexOf("signInAnonymously("));
    }
    const apple = segmentAfter(authContext, "const continueWithApple = async", 600);
    expect(apple.indexOf("restoreBeforeNewIdentity(")).toBeGreaterThanOrEqual(0);
    expect(apple.indexOf("restoreBeforeNewIdentity(")).toBeLessThan(apple.indexOf("signInWith("));
  });

  it("the waiting page alerts before it clears a rejected / expired request (review minor)", () => {
    const panel = segmentAfter(authScreen, "function JoinPendingPanel", 2200);
    const alertAt = panel.indexOf("Alert.alert(");
    expect(alertAt).toBeGreaterThanOrEqual(0);
    expect(alertAt).toBeLessThan(panel.indexOf("dismissRef.current()"));
    // AuthContext 不在 rejected / expired 时抢先清状态：check 里唯一的清理在 approved 分支里。
    const check = segmentAfter(authContext, "const checkPendingJoinRequest = async", 1400);
    const approved = check.indexOf('outcome === "approved"');
    expect(approved).toBeGreaterThanOrEqual(0);
    expect(check.indexOf("clearPersistedPendingJoin(")).toBeGreaterThan(approved);
  });

  it("the anonymous identity is created only from the Start button (decision 1A)", () => {
    const calls = sourceFiles(SRC).filter((file) => readFileSync(file, "utf8").includes("signInAnonymously("));
    expect(calls.map((file) => file.replace(SRC, ""))).toEqual([join("/auth", "AuthContext.tsx")]);
    // AuthContext 里只有 startAnonymously（开始使用）和 joinByCode（凭码加入）两处，启动流程里没有。
    const boot = segmentAfter(authContext, "const boot = async", 2500);
    expect(boot).not.toContain("signInAnonymously(");
  });
});

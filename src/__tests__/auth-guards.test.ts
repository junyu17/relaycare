import { describe, expect, it } from "vitest";
import {
  accountIdLabel,
  canInvite,
  canPurchase,
  classifyUserChange,
  hasAppleIdentity,
  isAnonymousUser,
  isAccountGoneError,
  isAppleCancelError,
  isIdentityAlreadyExistsError,
  mayCreateNewIdentity,
  parseAppleConflictResult,
  pickActiveHouseholdId,
  postMembershipLossAction,
  shouldDropAnchorAfterRestoreError,
  shouldRefreshUser,
  signOutDecision,
  type MembershipLossReason,
  type UserLike
} from "../auth/guards";
import { decideStartupRestore, detectMigratedDevice, parseAnchor } from "../auth/anonymousAnchor";

const anon: UserLike = { id: "u-1", is_anonymous: true, identities: [] };
const linked: UserLike = { id: "u-1", is_anonymous: false, identities: [{ provider: "apple" }] };

describe("shouldRefreshUser (L93: same-id USER_UPDATED after linkIdentity)", () => {
  it("refreshes the user when is_anonymous flips for the same id", () => {
    expect(shouldRefreshUser(anon, linked)).toBe(true);
    expect(classifyUserChange(anon, linked)).toBe("refresh");
  });

  it("refreshes when an identity is added even if is_anonymous did not flip", () => {
    const appleButStillFlagged: UserLike = { ...anon, identities: [{ provider: "apple" }] };
    expect(shouldRefreshUser(anon, appleButStillFlagged)).toBe(true);
  });

  it("does nothing for TOKEN_REFRESHED with an unchanged user", () => {
    expect(shouldRefreshUser(anon, { ...anon })).toBe(false);
    expect(classifyUserChange(linked, { ...linked, identities: [{ provider: "apple" }] })).toBe("same");
  });

  it("treats a different id as an account switch, never as a refresh", () => {
    expect(classifyUserChange(anon, { ...linked, id: "u-2" })).toBe("switch");
    expect(shouldRefreshUser(anon, { ...linked, id: "u-2" })).toBe(false);
    expect(classifyUserChange(null, anon)).toBe("switch");
    expect(classifyUserChange(anon, null)).toBe("switch");
  });
});

describe("anonymous / bound detection", () => {
  it("is anonymous only while GoTrue flags it and there is no Apple identity", () => {
    expect(isAnonymousUser(anon)).toBe(true);
    expect(isAnonymousUser(linked)).toBe(false);
    // 设计前提的兜底：linkIdentity 之后 is_anonymous 没翻转，有 Apple 身份也按已绑定处理。
    expect(isAnonymousUser({ ...anon, identities: [{ provider: "apple" }] })).toBe(false);
    expect(isAnonymousUser({ id: "e", is_anonymous: false, identities: [{ provider: "email" }] })).toBe(false);
    expect(isAnonymousUser(null)).toBe(false);
  });

  it("reads the Apple identity from identities or app_metadata", () => {
    expect(hasAppleIdentity(linked)).toBe(true);
    expect(hasAppleIdentity({ id: "x", app_metadata: { providers: ["apple"] } })).toBe(true);
    expect(hasAppleIdentity(anon)).toBe(false);
  });
});

describe("canInvite / canPurchase", () => {
  it("only a bound coordinator can see or generate join codes", () => {
    expect(canInvite({ isAnonymous: false, role: "coordinator" })).toBe(true);
    expect(canInvite({ isAnonymous: true, role: "coordinator" })).toBe(false);
    expect(canInvite({ isAnonymous: false, role: "caregiver" })).toBe(false);
    expect(canInvite({ isAnonymous: false, role: null })).toBe(false);
  });

  it("anonymous users bind before StoreKit opens", () => {
    expect(canPurchase({ isAnonymous: true })).toBe(false);
    expect(canPurchase({ isAnonymous: false })).toBe(true);
  });
});

describe("requestSignOut decision", () => {
  it("an anonymous session needs confirmation", () => {
    expect(signOutDecision({ isAnonymous: true })).toBe("needs_confirmation");
  });

  it("signs out after the user confirms the loss, or after the account was deleted", () => {
    expect(signOutDecision({ isAnonymous: true, confirmedAnonymousLoss: true })).toBe("sign_out");
    expect(signOutDecision({ isAnonymous: true, reason: "account_deleted" })).toBe("sign_out");
  });

  it("a bound user signs out directly", () => {
    expect(signOutDecision({ isAnonymous: false })).toBe("sign_out");
  });
});

describe("postMembershipLossAction never signs out", () => {
  const reasons: MembershipLossReason[] = ["left", "dissolved", "removed"];
  it("always refreshes households instead, for every input", () => {
    for (const reason of reasons) {
      for (const isPayer of [true, false]) {
        const action = postMembershipLossAction({ reason, isPayer });
        expect(action.kind).toBe("refresh_households");
        expect(JSON.stringify(action)).not.toMatch(/sign_?out/i);
        expect(action.clearCaches).toBe(true);
      }
    }
  });

  it("warns a payer who was removed (left/dissolved were warned before acting)", () => {
    expect(postMembershipLossAction({ reason: "removed", isPayer: true }).warnSubscription).toBe(true);
    expect(postMembershipLossAction({ reason: "removed", isPayer: false }).warnSubscription).toBe(false);
    expect(postMembershipLossAction({ reason: "left", isPayer: true }).warnSubscription).toBe(false);
  });
});

describe("decideStartupRestore (Keychain anchor after reinstall)", () => {
  const anchor = { userId: "u-1", refreshToken: "r-1" };
  it("restores when there is no session and there is an anchor", () => {
    expect(decideStartupRestore(false, anchor)).toBe("restore");
  });
  it("does nothing when a session exists or there is no anchor", () => {
    expect(decideStartupRestore(true, anchor)).toBe("none");
    expect(decideStartupRestore(false, null)).toBe("none");
    expect(decideStartupRestore(false, { userId: "u-1", refreshToken: "" })).toBe("none");
  });
  it("parses only well-formed anchors", () => {
    expect(parseAnchor(JSON.stringify(anchor))).toEqual(anchor);
    expect(parseAnchor("not json")).toBeNull();
    expect(parseAnchor(JSON.stringify({ userId: "u-1" }))).toBeNull();
    expect(parseAnchor(null)).toBeNull();
  });
});

describe("detectMigratedDevice", () => {
  it("flags a backup-migrated phone: storage flag came along, the THIS_DEVICE_ONLY marker did not", () => {
    expect(detectMigratedDevice({ keychainMarker: false, storageFlag: true, sessionIsAnonymous: true })).toBe(true);
  });
  it("does not flag a fresh install or an upgrade from 1.9 (neither marker existed)", () => {
    expect(detectMigratedDevice({ keychainMarker: false, storageFlag: false, sessionIsAnonymous: true })).toBe(false);
  });
  it("does not flag the same device, a bound user, or an unreadable Keychain", () => {
    expect(detectMigratedDevice({ keychainMarker: true, storageFlag: true, sessionIsAnonymous: true })).toBe(false);
    expect(detectMigratedDevice({ keychainMarker: false, storageFlag: true, sessionIsAnonymous: false })).toBe(false);
    expect(detectMigratedDevice({ keychainMarker: null, storageFlag: true, sessionIsAnonymous: true })).toBe(false);
  });
});

describe("Apple and restore error mapping", () => {
  it("maps a user cancel to a silent cancel", () => {
    expect(isAppleCancelError({ code: "ERR_REQUEST_CANCELED" })).toBe(true);
    expect(isAppleCancelError({ code: "ERR_REQUEST_FAILED" })).toBe(false);
    expect(isAppleCancelError(new Error("x"))).toBe(false);
  });

  it("recognizes identity_already_exists from linkIdentity", () => {
    expect(isIdentityAlreadyExistsError({ code: "identity_already_exists", status: 422 })).toBe(true);
    expect(isIdentityAlreadyExistsError({ message: "Identity is already linked to another user" })).toBe(true);
    expect(isIdentityAlreadyExistsError({ code: "validation_failed" })).toBe(false);
  });

  it("drops the anchor only when the server rejected the refresh token", () => {
    expect(shouldDropAnchorAfterRestoreError({ name: "AuthApiError", status: 400 })).toBe(true);
    expect(shouldDropAnchorAfterRestoreError({ name: "AuthApiError", status: 401 })).toBe(true);
    expect(shouldDropAnchorAfterRestoreError({ name: "AuthRetryableFetchError", status: 0 })).toBe(false);
    expect(shouldDropAnchorAfterRestoreError({ name: "AuthApiError", status: 503 })).toBe(false);
    // 评审 minor：GoTrue 的限流（429）和超时（408）是暂时的，不能因此丢掉唯一能找回家庭的锚点。
    expect(shouldDropAnchorAfterRestoreError({ name: "AuthApiError", status: 429 })).toBe(false);
    expect(shouldDropAnchorAfterRestoreError({ name: "AuthApiError", status: 408 })).toBe(false);
  });

  it("creates a new identity only when there is no anchor left to restore", () => {
    expect(mayCreateNewIdentity("none")).toBe(true);
    expect(mayCreateNewIdentity("retry_later")).toBe(false);
    expect(mayCreateNewIdentity("restored")).toBe(false);
  });

  it("treats only user_not_found as a deleted account (never a network or token error)", () => {
    expect(isAccountGoneError({ name: "AuthApiError", status: 403, code: "user_not_found" })).toBe(true);
    expect(isAccountGoneError({ name: "AuthApiError", status: 403, code: "bad_jwt" })).toBe(false);
    expect(isAccountGoneError({ name: "AuthRetryableFetchError", status: 0 })).toBe(false);
    expect(isAccountGoneError({ name: "AuthSessionMissingError", status: 400 })).toBe(false);
    expect(isAccountGoneError(null)).toBe(false);
  });

  it("parses the apple-identity-conflict result", () => {
    expect(parseAppleConflictResult({ result: "freed" })).toBe("freed");
    expect(parseAppleConflictResult({ status: "caller_empty" })).toBe("caller_empty");
    expect(parseAppleConflictResult("both_have_data")).toBe("both_have_data");
    expect(() => parseAppleConflictResult({ result: "delete_everything" })).toThrow();
  });
});

describe("pickActiveHouseholdId", () => {
  const list = [
    { id: "h-1", isActive: false },
    { id: "h-2", isActive: true }
  ];
  it("uses the preferred household only when it is still in the list", () => {
    expect(pickActiveHouseholdId(list, "h-1")).toBe("h-1");
    // 评审 minor：30 天前批准、后来又退出的那一户不能再被选中。
    expect(pickActiveHouseholdId(list, "h-gone")).toBe("h-2");
  });
  it("falls back to the server's active household, then the first, then none", () => {
    expect(pickActiveHouseholdId(list)).toBe("h-2");
    expect(pickActiveHouseholdId([{ id: "h-3" }, { id: "h-4" }])).toBe("h-3");
    expect(pickActiveHouseholdId([], "h-gone")).toBeNull();
  });
});

describe("accountIdLabel", () => {
  it("shows the first 8 characters of the uid", () => {
    expect(accountIdLabel("3f2a9c1e-77aa-4b0e-9d1d-0c5e2f8a1b2c")).toBe("3F2A9C1E");
    expect(accountIdLabel(null)).toBe("");
  });
});

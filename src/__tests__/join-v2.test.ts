import { describe, expect, it } from "vitest";
import {
  isActiveJoinRequest,
  joinStatusMessageKey,
  keepCodeAfterJoin,
  parseJoinV2Response,
  parseLegacyJoinResponse,
  parseMyJoinRequests,
  pendingJoinIsStale,
  pendingOutcomeAlertKey,
  resolvePendingJoin,
  waitsForRequest,
  JOIN_REQUEST_TTL_MS
} from "../lib/joinV2";
import { errorHintKey, localizedErrorMessage } from "../lib/error";
import { translations } from "../i18n";

describe("join_by_code_v2 status mapping", () => {
  it("parses every status the RPC can return", () => {
    expect(parseJoinV2Response({ status: "joined", household_id: "h-1" })).toEqual({
      status: "joined",
      householdId: "h-1",
      requestId: null
    });
    expect(parseJoinV2Response({ status: "pending", request_id: "r-1" })).toMatchObject({
      status: "pending",
      requestId: "r-1"
    });
    for (const status of ["invalid", "rate_limited", "requests_full"]) {
      expect(parseJoinV2Response({ status }).status).toBe(status);
    }
    // 0059 熔断中：已有 pending 的账号再提交任何码，服务端不看码就返回原来那条申请。
    expect(parseJoinV2Response({ status: "already_pending", request_id: "r-0" })).toEqual({
      status: "already_pending",
      householdId: null,
      requestId: "r-0"
    });
  });

  it("accepts a jsonb row wrapped in an array", () => {
    expect(parseJoinV2Response([{ status: "joined", household_id: "h-2" }]).householdId).toBe("h-2");
  });

  it("rejects an unknown status instead of guessing", () => {
    expect(() => parseJoinV2Response({ status: "approved" })).toThrow();
    expect(() => parseJoinV2Response(null)).toThrow();
  });

  it("maps the legacy RPC: NULL means invalid code, a uuid means joined", () => {
    expect(parseLegacyJoinResponse(null).status).toBe("invalid");
    expect(parseLegacyJoinResponse("h-3")).toEqual({ status: "joined", householdId: "h-3", requestId: null });
  });

  it("shows a message for every status except joined / pending", () => {
    expect(joinStatusMessageKey("joined")).toBeNull();
    expect(joinStatusMessageKey("pending")).toBeNull();
    expect(joinStatusMessageKey("invalid")).toBe("errors.codeInvalid");
    expect(joinStatusMessageKey("rate_limited")).toBe("errors.joinRateLimited");
    expect(joinStatusMessageKey("requests_full")).toBe("errors.requestsFull");
    expect(joinStatusMessageKey("already_pending")).toBe("errors.requestPendingElsewhere");
  });

  it("keeps the code in the Join tab only when the join neither succeeded nor went pending", () => {
    expect(keepCodeAfterJoin("joined")).toBe(false);
    expect(keepCodeAfterJoin("pending")).toBe(false);
    expect(keepCodeAfterJoin("invalid")).toBe(true);
    expect(keepCodeAfterJoin("rate_limited")).toBe(true);
    expect(keepCodeAfterJoin("requests_full")).toBe(true);
    // 回到原来那条申请的等待页，这次输入的码留着，换码时不用重输。
    expect(keepCodeAfterJoin("already_pending")).toBe(true);
  });

  it("shows the waiting page for a new request and for the request already waiting", () => {
    expect(waitsForRequest("pending")).toBe(true);
    expect(waitsForRequest("already_pending")).toBe(true);
    for (const status of ["joined", "invalid", "rate_limited", "requests_full"] as const) {
      expect(waitsForRequest(status)).toBe(false);
    }
  });
});

describe("PostgREST hint mapping", () => {
  const hints: Record<string, string> = {
    join_rate_limited: "errors.joinRateLimited",
    join_code_expired: "errors.codeInvalid",
    account_binding_required: "errors.bindingRequired",
    target_not_bound: "errors.targetNotBound",
    requests_full: "errors.requestsFull",
    already_pending: "errors.requestPendingElsewhere",
    restore_retry: "errors.restoreRetry",
    account_gone: "auth.accountGone"
  };

  it("maps each stable hint to an i18n key present in all six languages", () => {
    for (const [hint, key] of Object.entries(hints)) {
      expect(errorHintKey({ message: "Too many join attempts.", hint })).toBe(key);
      for (const lang of ["en", "zh", "zhHant", "es", "ja", "ko"] as const) {
        expect(translations[lang][key], `${lang}:${key}`).toBeTruthy();
      }
    }
  });

  it("falls back to the original message when there is no known hint", () => {
    const t = (key: string) => translations.en[key] ?? key;
    expect(localizedErrorMessage({ message: "Code has expired" }, t)).toBe("Code has expired");
    expect(localizedErrorMessage({ message: "boom", hint: "something_else" }, t)).toBe("boom");
    expect(localizedErrorMessage({ message: "x", hint: "join_rate_limited" }, t)).toBe(
      translations.en["errors.joinRateLimited"]
    );
  });
});

describe("pending join request (applicant side)", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  const pending = { userId: "u-1", requestId: "r-1", createdAt: "2026-10-02T11:00:00Z" };

  it("parses my_join_requests rows and ignores malformed ones", () => {
    const rows = parseMyJoinRequests([
      { id: "r-1", status: "pending", created_at: "2026-10-02T11:00:00Z" },
      { id: "r-2", status: "approved", household_id: "h-1", created_at: "2026-10-01T11:00:00Z" },
      { id: "r-3", status: "weird" },
      null
    ]);
    expect(rows.map((r) => r.id)).toEqual(["r-1", "r-2"]);
    expect(parseMyJoinRequests(null)).toEqual([]);
  });

  it("keeps waiting while pending, and follows approve / reject by request id", () => {
    const base = { id: "r-1", householdId: null, createdAt: pending.createdAt };
    expect(resolvePendingJoin(pending, [{ ...base, status: "pending" }], now).outcome).toBe("pending");
    expect(resolvePendingJoin(pending, [{ ...base, status: "approved", householdId: "h-9" }], now)).toEqual({
      outcome: "approved",
      householdId: "h-9"
    });
    expect(resolvePendingJoin(pending, [{ ...base, status: "rejected" }], now).outcome).toBe("rejected");
  });

  it("treats a request older than 24 hours as expired", () => {
    const old = { ...pending, createdAt: new Date(now - JOIN_REQUEST_TTL_MS - 1000).toISOString() };
    const row = { id: "r-1", status: "pending" as const, householdId: null, createdAt: old.createdAt };
    expect(resolvePendingJoin(old, [row], now).outcome).toBe("expired");
    expect(resolvePendingJoin(old, [], now).outcome).toBe("expired");
    expect(resolvePendingJoin(pending, [], now).outcome).toBe("pending");
  });

  it("never mistakes an older request for this one when the id is known", () => {
    const olderRejected = {
      id: "r-0",
      status: "rejected" as const,
      householdId: null,
      createdAt: "2026-10-01T09:00:00Z"
    };
    expect(resolvePendingJoin(pending, [olderRejected], now).outcome).toBe("pending");
  });

  it("falls back to the newest request when the RPC did not return an id", () => {
    const noId = { ...pending, requestId: null };
    const rows = [
      { id: "old", status: "rejected" as const, householdId: null, createdAt: "2026-09-30T10:00:00Z" },
      { id: "new", status: "approved" as const, householdId: "h-2", createdAt: "2026-10-02T11:30:00Z" }
    ];
    expect(resolvePendingJoin(noId, rows, now)).toEqual({ outcome: "approved", householdId: "h-2" });
  });
});

describe("waiting page outcome handling", () => {
  it("alerts on rejected / expired only; approved enters the household without an alert", () => {
    expect(pendingOutcomeAlertKey("rejected")).toBe("join.requestRejected");
    expect(pendingOutcomeAlertKey("expired")).toBe("join.requestExpired");
    expect(pendingOutcomeAlertKey("approved")).toBeNull();
    expect(pendingOutcomeAlertKey("pending")).toBeNull();
    expect(pendingOutcomeAlertKey("none")).toBeNull();
    for (const lang of ["en", "zh", "zhHant", "es", "ja", "ko"] as const) {
      expect(translations[lang]["join.requestRejected"], lang).toBeTruthy();
      expect(translations[lang]["join.requestExpired"], lang).toBeTruthy();
    }
  });

  it("drops a remembered request once the account has a household (approved while the app was closed)", () => {
    expect(pendingJoinIsStale(null)).toBe(false); // 还没加载过家庭：不能丢
    expect(pendingJoinIsStale(0)).toBe(false); // 没有家庭：等待页要用它
    expect(pendingJoinIsStale(1)).toBe(true);
    expect(pendingJoinIsStale(3)).toBe(true);
  });
});

describe("coordinator side: which requests are shown", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  it("shows only pending requests younger than 24 hours", () => {
    expect(isActiveJoinRequest({ status: "pending", createdAt: "2026-10-02T10:00:00Z" }, now)).toBe(true);
    expect(isActiveJoinRequest({ status: "pending", createdAt: "2026-09-30T10:00:00Z" }, now)).toBe(false);
    expect(isActiveJoinRequest({ status: "approved", createdAt: "2026-10-02T10:00:00Z" }, now)).toBe(false);
  });
});

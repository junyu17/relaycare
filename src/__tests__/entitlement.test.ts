import { describe, expect, it } from "vitest";
import {
  effectivePlan,
  isPlusPlan,
  PLAN_LIMITS,
  checkTaskQuota,
  checkMemberQuota,
  checkOcrQuota,
  checkFileSize
} from "../lib/entitlement";
import type { AppState, Plan } from "../types";

// H1（R3）：恢复 R2 被删的配额/套餐测试（effectivePlan / isPlusPlan / PLAN_LIMITS / checkTaskQuota / checkOcrQuota / checkFileSize）

describe("effectivePlan", () => {
  it("returns the stored plan for households", () => {
    const h = {
      id: "h1",
      name: "H",
      timezone: "UTC",
      inviteExpiresAt: "2099-01-01T00:00:00.000Z",
      careRecipientLabel: "Dad",
      plusPlan: "yearly" as Plan,
      plusUntil: "2099-01-01T00:00:00.000Z"
    };
    expect(effectivePlan(h)).toBe("yearly");
    const free = { ...h, plusPlan: "free" as Plan, plusUntil: undefined };
    expect(effectivePlan(free)).toBe("free");
  });

  it("expired plus falls back to free", () => {
    const h = {
      id: "h1",
      name: "H",
      timezone: "UTC",
      inviteExpiresAt: "2099-01-01T00:00:00.000Z",
      careRecipientLabel: "Dad",
      plusPlan: "monthly" as Plan,
      plusUntil: "2020-01-01T00:00:00.000Z"
    };
    expect(effectivePlan(h)).toBe("free");
  });
});

describe("isPlusPlan", () => {
  it("monthly/yearly are plus; free is not", () => {
    expect(isPlusPlan("monthly")).toBe(true);
    expect(isPlusPlan("yearly")).toBe(true);
    expect(isPlusPlan("free")).toBe(false);
  });
});

describe("PLAN_LIMITS (A2: spec values, R4)", () => {
  it("free plan spec values match paywall claims", () => {
    expect(PLAN_LIMITS.free.households).toBe(1);
    expect(PLAN_LIMITS.free.members).toBe(3);
    expect(PLAN_LIMITS.free.inProgressTasks).toBe(10);
    expect(PLAN_LIMITS.free.ocrPerMonth).toBe(1);
    expect(PLAN_LIMITS.free.auditRetentionDays).toBe(30);
    expect(PLAN_LIMITS.free.weeklyReportAuto).toBe(false);
    expect(PLAN_LIMITS.free.exportEnabled).toBe(false);
  });
  it("plus plan spec values (monthly & yearly share limits)", () => {
    expect(PLAN_LIMITS.monthly.members).toBe(12);
    expect(PLAN_LIMITS.monthly.ocrPerMonth).toBe(50);
    expect(PLAN_LIMITS.monthly.auditRetentionDays).toBe(1095);
    expect(PLAN_LIMITS.monthly.inProgressTasks).toBe(Number.POSITIVE_INFINITY);
    expect(PLAN_LIMITS.monthly.exportEnabled).toBe(true);
    expect(PLAN_LIMITS.yearly).toEqual(PLAN_LIMITS.monthly);
  });
  it("free vs plus limits are distinct", () => {
    expect(PLAN_LIMITS.free.members).toBeLessThan(PLAN_LIMITS.monthly.members);
    expect(PLAN_LIMITS.free.inProgressTasks).toBeLessThan(
      Number.isFinite(PLAN_LIMITS.monthly.inProgressTasks) ? PLAN_LIMITS.monthly.inProgressTasks : 1e9
    );
    expect(PLAN_LIMITS.free.ocrPerMonth).toBeLessThan(PLAN_LIMITS.monthly.ocrPerMonth);
    expect(PLAN_LIMITS.free.exportEnabled).toBe(false);
    expect(PLAN_LIMITS.monthly.exportEnabled).toBe(true);
  });
});

function makeState(plus: boolean, tasks = 0, ocrUsed = 0, members = 0): AppState {
  const nowIso = new Date().toISOString();
  const household = {
    id: "h",
    name: "H",
    timezone: "UTC",
    inviteExpiresAt: "2099-01-01T00:00:00.000Z",
    careRecipientLabel: "Dad",
    plusPlan: (plus ? "yearly" : "free") as Plan,
    plusUntil: plus ? "2099-01-01T00:00:00.000Z" : undefined
  };
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const tasksArr = Array.from({ length: tasks }, (_, i) => ({
    id: `t${i}`,
    household_id: "h",
    title: "t",
    expected_minutes: 10,
    due_at: null,
    priority: "normal" as const,
    status: "open" as const,
    requested_by_id: "m",
    created_at: now.toISOString(),
    document_id: null,
    subtasks: []
  }));
  return {
    household,
    members: Array.from({ length: members }, (_, i) => ({
      id: `m${i}`,
      household_id: "h",
      name: `M${i}`,
      role: "caregiver",
      invite_status: "active",
      userId: `u${i}`,
      timezone: "UTC"
    })) as never,
    roleDefinitions: [],
    notificationPreferences: [],
    roleNotifications: [],
    tasks: tasksArr as never,
    events: [],
    documents: Array.from({ length: ocrUsed }, (_, i) => ({
      id: `d${i}`,
      household_id: "h",
      name: "d",
      source: "manual_upload",
      uploaded_at: nowIso,
      uploaded_by_id: "m",
      status: "uploaded",
      createdAt: nowIso,
      uploadedAt: nowIso,
      nameKey: "d"
    })) as never,
    auditEvents: [],
    ocrUsedThisMonth: ocrUsed,
    monthKey: month
  } as AppState;
}

describe("checkMemberQuota (A2: R4)", () => {
  it("free caps members at 3; plus allows more", () => {
    expect(checkMemberQuota(makeState(false, 0, 0, 2)).ok).toBe(true); // free 2/3：还能加
    expect(checkMemberQuota(makeState(false, 0, 0, 3)).ok).toBe(false); // free 3/3：满员被拦
    expect(checkMemberQuota(makeState(true, 0, 0, 11)).ok).toBe(true); // plus 11/12：还能加
    expect(checkMemberQuota(makeState(true, 0, 0, 12)).ok).toBe(false); // plus 12/12：满员
  });
});

describe("checkTaskQuota", () => {
  it("free caps in-progress tasks", () => {
    expect(checkTaskQuota(makeState(false, PLAN_LIMITS.free.inProgressTasks - 1)).ok).toBe(true);
    expect(checkTaskQuota(makeState(false, PLAN_LIMITS.free.inProgressTasks + 1)).ok).toBe(false);
    expect(checkTaskQuota(makeState(true, 100)).ok).toBe(true);
  });
});

describe("checkOcrQuota / checkFileSize", () => {
  it("ocr quota counts by month and plan", () => {
    expect(checkOcrQuota(makeState(false, 0, PLAN_LIMITS.free.ocrPerMonth - 1)).ok).toBe(true);
    expect(checkOcrQuota(makeState(false, 0, PLAN_LIMITS.free.ocrPerMonth + 1)).ok).toBe(false);
  });
  it("file size respects hard cap", () => {
    expect(checkFileSize(1024 * 1024)).toBe(true);
    expect(checkFileSize(100 * 1024 * 1024)).toBe(false);
  });
});

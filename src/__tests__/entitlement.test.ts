import { describe, expect, it } from "vitest";
import {
  effectivePlan,
  isPlusPlan,
  PLAN_LIMITS,
  checkTaskQuota,
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

describe("PLAN_LIMITS", () => {
  it("free vs plus limits are distinct (no accidental upgrade)", () => {
    expect(PLAN_LIMITS.free.members).toBeLessThan(PLAN_LIMITS.monthly.members);
    expect(PLAN_LIMITS.free.inProgressTasks).toBeLessThan(
      Number.isFinite(PLAN_LIMITS.monthly.inProgressTasks) ? PLAN_LIMITS.monthly.inProgressTasks : 1e9
    );
    expect(PLAN_LIMITS.free.ocrPerMonth).toBeLessThan(PLAN_LIMITS.monthly.ocrPerMonth);
    expect(PLAN_LIMITS.free.exportEnabled).toBe(false);
    expect(PLAN_LIMITS.monthly.exportEnabled).toBe(true);
  });
});

function makeState(plus: boolean, tasks = 0, ocrUsed = 0): AppState {
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
    members: [],
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

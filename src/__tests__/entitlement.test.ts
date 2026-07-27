import { describe, expect, it } from "vitest";
import { initialState } from "../data";
import {
  PLAN_LIMITS,
  effectivePlan,
  checkTaskQuota,
  checkMemberQuota,
  checkOcrQuota,
  checkFileSize,
  MAX_FILE_SIZE_BYTES,
  isPlusPlan
} from "../lib/entitlement";

const freeHousehold = { ...initialState.household, plusPlan: "free" as const };
const plusHousehold = {
  ...initialState.household,
  plusPlan: "yearly" as const,
  plusUntil: new Date(Date.now() + 86400000).toISOString(),
  plusOwnerId: "m-maya"
};
const expiredPlusHousehold = {
  ...initialState.household,
  plusPlan: "monthly" as const,
  plusUntil: new Date(Date.now() - 86400000).toISOString()
};

describe("effectivePlan", () => {
  it("reports free for a free household", () => {
    expect(effectivePlan(freeHousehold)).toBe("free");
  });
  it("reports plus while the subscription is in the future", () => {
    expect(effectivePlan(plusHousehold)).toBe("yearly");
  });
  it("falls back to free when plus has expired", () => {
    expect(effectivePlan(expiredPlusHousehold)).toBe("free");
  });
});

describe("isPlusPlan", () => {
  it("treats monthly and yearly as plus, free as not", () => {
    expect(isPlusPlan("monthly")).toBe(true);
    expect(isPlusPlan("yearly")).toBe(true);
    expect(isPlusPlan("free")).toBe(false);
  });
});

describe("PLAN_LIMITS", () => {
  it("enforces the spec'd free limits", () => {
    expect(PLAN_LIMITS.free.households).toBe(1);
    expect(PLAN_LIMITS.free.members).toBe(3);
    expect(PLAN_LIMITS.free.inProgressTasks).toBe(10);
    expect(PLAN_LIMITS.free.ocrPerMonth).toBe(1);
    expect(PLAN_LIMITS.free.auditRetentionDays).toBe(30);
    expect(PLAN_LIMITS.free.exportEnabled).toBe(false);
  });
  it("enforces the spec'd plus limits", () => {
    expect(PLAN_LIMITS.yearly.households).toBe(3);
    expect(PLAN_LIMITS.yearly.members).toBe(12);
    expect(PLAN_LIMITS.yearly.ocrPerMonth).toBe(50);
    expect(PLAN_LIMITS.yearly.auditRetentionDays).toBe(1095);
    expect(PLAN_LIMITS.yearly.exportEnabled).toBe(true);
    expect(PLAN_LIMITS.yearly.advancedNotifications).toBe(true);
  });
});

describe("quota checks", () => {
  it("blocks the 11th in-progress task on free, allows on plus", () => {
    const freeState = { ...initialState, household: freeHousehold };
    expect(checkTaskQuota({ ...freeState, tasks: elevenOpenTasks() }).ok).toBe(false);
    const plusState = { ...initialState, household: plusHousehold };
    expect(checkTaskQuota({ ...plusState, tasks: elevenOpenTasks() }).ok).toBe(true);
  });
  it("blocks the 4th member on free, allows on plus", () => {
    const freeState = { ...initialState, household: freeHousehold, members: fourMembers() };
    expect(checkMemberQuota(freeState).ok).toBe(false);
    const plusState = { ...initialState, household: plusHousehold, members: fourMembers() };
    expect(checkMemberQuota(plusState).ok).toBe(true);
  });
  it("counts only manual uploads this month toward the OCR quota", () => {
    const state = {
      ...initialState,
      household: freeHousehold,
      documents: [
        { ...initialState.documents[0], source: "manual_upload" as const, uploadedAt: new Date().toISOString() },
        { ...initialState.documents[0], source: "sample" as const, uploadedAt: new Date().toISOString() },
        { ...initialState.documents[0], source: "manual_upload" as const, uploadedAt: "2020-01-01T00:00:00Z" }
      ]
    };
    expect(checkOcrQuota(state).used).toBe(1);
    expect(checkOcrQuota(state).ok).toBe(false); // free limit 1, already used 1
  });
});

describe("file size check", () => {
  it("allows 25 MB, rejects larger", () => {
    expect(checkFileSize(MAX_FILE_SIZE_BYTES)).toBe(true);
    expect(checkFileSize(MAX_FILE_SIZE_BYTES + 1)).toBe(false);
  });
});

function elevenOpenTasks() {
  const base = initialState.tasks.filter((task) => task.status !== "completed");
  const open = { ...base[0], id: "t-extra-1", status: "open" as const };
  const arr = [open, ...base];
  // pad to 11 open tasks
  while (arr.filter((task) => task.status !== "completed").length < 11) {
    arr.push({ ...open, id: `t-extra-${arr.length}` });
  }
  return arr;
}

function fourMembers() {
  return [...initialState.members, { ...initialState.members[0], id: "m-extra" }];
}

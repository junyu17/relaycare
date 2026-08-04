import { describe, expect, it } from "vitest";
import { initialState } from "../data";
import {
  claimTask,
  completeTask,
  confirmDocumentAndCreateTask,
  createTask,
  formatDateTime,
  hasPermission,
  inviteMember,
  isHouseholdInviteExpired,
  memberName,
  requestHandoff,
  updateMemberRole,
  withAudit
} from "../domain";
import { makeTranslator } from "../i18n";

const coordinator = initialState.members[0]; // Maya, coordinator
const caregiver = initialState.members[1]; // Eli, caregiver
const anotherCaregiver = initialState.members[2]; // Sam, caregiver with task:claim
const openTaskId = initialState.tasks[0].id; // t-transport, open, critical

describe("hasPermission", () => {
  it("grants coordinator all capabilities", () => {
    expect(hasPermission(initialState, "coordinator", "audit:read")).toBe(true);
    expect(hasPermission(initialState, "coordinator", "member:invite")).toBe(true);
    expect(hasPermission(initialState, "coordinator", "task:claim")).toBe(true);
  });

  it("locks viewer to timeline read only", () => {
    expect(hasPermission(initialState, "viewer", "timeline:read")).toBe(true);
    expect(hasPermission(initialState, "viewer", "task:claim")).toBe(false);
    expect(hasPermission(initialState, "viewer", "audit:read")).toBe(false);
    expect(hasPermission(initialState, "viewer", "document:upload")).toBe(false);
  });

  it("lets caregiver act on tasks but not manage roles or audit", () => {
    expect(hasPermission(initialState, "caregiver", "task:claim")).toBe(true);
    expect(hasPermission(initialState, "caregiver", "task:complete")).toBe(true);
    expect(hasPermission(initialState, "caregiver", "member:role_update")).toBe(false);
    expect(hasPermission(initialState, "caregiver", "audit:read")).toBe(false);
  });
});

describe("isHouseholdInviteExpired", () => {
  it("is not expired before the configured invite expiry", () => {
    expect(isHouseholdInviteExpired(initialState, new Date("2026-07-23T00:00:00-07:00"))).toBe(false);
  });

  it("is expired at/after the configured invite expiry", () => {
    expect(isHouseholdInviteExpired(initialState, new Date("2026-07-25T00:00:00-07:00"))).toBe(true);
  });

  it("treats an unparseable expiry as expired (fail-safe)", () => {
    const broken = {
      ...initialState,
      household: { ...initialState.household, inviteExpiresAt: "not-a-date" }
    };
    expect(isHouseholdInviteExpired(broken)).toBe(true);
  });
});

describe("claimTask", () => {
  it("marks the task claimed, assigns the owner, and writes an audit event", () => {
    const next = claimTask(initialState, openTaskId, caregiver);
    const task = next.tasks.find((item) => item.id === openTaskId)!;
    expect(task.status).toBe("claimed");
    expect(task.ownerId).toBe(caregiver.id);
    expect(task.handoffToId).toBeUndefined();
    expect(next.auditEvents[0].action).toBe("task.claimed");
    expect(next.auditEvents[0].entityId).toBe(openTaskId);
    expect(next.auditEvents[0].actorId).toBe(caregiver.id);
  });

  it("does not mutate the original state", () => {
    const before = initialState.tasks.find((item) => item.id === openTaskId)!;
    claimTask(initialState, openTaskId, caregiver);
    expect(before.status).toBe("open");
    expect(before.ownerId).toBeUndefined();
  });
});

describe("createTask ID uniqueness", () => {
  it("produces distinct ids even when many are created in the same millisecond", () => {
    const ids = new Set<string>();
    let state = initialState;
    for (let index = 0; index < 50; index += 1) {
      state = createTask(state, coordinator, {
        title: `bulk task ${index}`,
        expectedMinutes: 10,
        dueAt: new Date(Date.now() + 3600000).toISOString(),
        priority: "normal",
        subtasks: []
      });
      ids.add(state.tasks[0].id);
    }
    expect(ids.size).toBe(50);
  });
});

describe("requestHandoff", () => {
  it("sets handoff_requested, records the target, and writes audit", () => {
    const claimed = claimTask(initialState, openTaskId, caregiver);
    const next = requestHandoff(claimed, openTaskId, caregiver, anotherCaregiver);
    const task = next.tasks.find((item) => item.id === openTaskId)!;
    expect(task.status).toBe("handoff_requested");
    expect(task.handoffToId).toBe(anotherCaregiver.id);
    expect(next.auditEvents[0].action).toBe("task.handoff_requested");
    expect(next.auditEvents[0].entityId).toBe(openTaskId);
  });
});

describe("completeTask", () => {
  it("marks completed, stores proof, writes audit, and adds a timeline event", () => {
    const claimed = claimTask(initialState, openTaskId, caregiver);
    const next = completeTask(claimed, openTaskId, caregiver);
    const task = next.tasks.find((item) => item.id === openTaskId)!;
    expect(task.status).toBe("completed");
    expect(task.proof).toBeTruthy();
    expect(next.auditEvents[0].action).toBe("task.completed");
    expect(next.events[0].type).toBe("reminder");
    expect(next.events[0].taskId).toBe(openTaskId);
    expect(next.events[0].ownerId).toBe(caregiver.id);
  });
});

describe("inviteMember", () => {
  it("adds a pending member, writes audit, and stores a language-neutral sentinel name", () => {
    const next = inviteMember(initialState, coordinator, "caregiver");
    const invited = next.members[next.members.length - 1];
    expect(invited.inviteStatus).toBe("pending");
    expect(invited.role).toBe("caregiver");
    expect(invited.name).toBe("New caregiver invite");
    expect(next.auditEvents[0].action).toBe("member.invited");
    expect(next.auditEvents[0].entityId).toBe(invited.id);
    // a notification preference is provisioned for the invite
    expect(next.notificationPreferences.some((pref) => pref.memberId === invited.id)).toBe(true);
  });
});

describe("confirmDocumentAndCreateTask", () => {
  it("confirms the document and creates a claimable task with both audit events", () => {
    const docId = initialState.documents[0].id;
    const next = confirmDocumentAndCreateTask(initialState, docId, coordinator);
    const doc = next.documents.find((item) => item.id === docId)!;
    expect(doc.status).toBe("confirmed");
    const derivedTask = next.tasks.find((item) => item.documentId === docId)!;
    expect(derivedTask).toBeTruthy();
    expect(derivedTask.status).toBe("open");
    const actions = next.auditEvents.slice(0, 2).map((event) => event.action);
    expect(actions).toContain("document.confirmed");
    expect(actions).toContain("document.task_created");
  });
});

describe("memberName", () => {
  it("re-localizes a pending caregiver invite per active language", () => {
    const state = inviteMember(initialState, coordinator, "caregiver");
    const invitedId = state.members[state.members.length - 1].id;
    expect(memberName(state, invitedId, makeTranslator("en"))).toBe("New caregiver invite");
    expect(memberName(state, invitedId, makeTranslator("zh"))).toBe("新的照护协助者邀请");
    expect(memberName(state, invitedId, makeTranslator("es"))).toBe("Nueva invitación de cuidador/a");
  });

  it("falls back for unassigned and unknown ids", () => {
    expect(memberName(initialState, undefined)).toBe("Unassigned");
    expect(memberName(initialState, "does-not-exist")).toBe("Unknown member");
  });
});

describe("withAudit", () => {
  it("prepends a new audit event without mutating the source state", () => {
    const before = initialState.auditEvents.length;
    const next = withAudit(initialState, coordinator.id, "report.generated", "report", "r-1", "snapshot");
    expect(next.auditEvents.length).toBe(before + 1);
    expect(next.auditEvents[0].entityId).toBe("r-1");
    expect(next.auditEvents[0].action).toBe("report.generated");
    expect(initialState.auditEvents.length).toBe(before);
  });
});

describe("updateMemberRole", () => {
  it("changes the target role and writes an audit event", () => {
    const target = initialState.members[3]; // Aunt Lee, viewer
    const next = updateMemberRole(initialState, target.id, "caregiver", coordinator);
    expect(next.members.find((member) => member.id === target.id)!.role).toBe("caregiver");
    expect(next.auditEvents[0].action).toBe("member.role_updated");
    expect(next.auditEvents[0].entityId).toBe(target.id);
  });
});

describe("formatDateTime defensive (crash engine zeroing)", () => {
  it("never throws for empty/invalid input (P0/P1 from full scan)", () => {
    expect(() => formatDateTime("")).not.toThrow();
    expect(() => formatDateTime("not-a-date")).not.toThrow();
    expect(() => formatDateTime("2024-13-45")).not.toThrow();
    expect(formatDateTime("")).toBe("");
    expect(formatDateTime("not-a-date")).toBe("");
    expect(() => formatDateTime(null as unknown as string)).not.toThrow();
    expect(formatDateTime(null as unknown as string)).toBe(""); // new Date(null)=epoch，早退拦下
    expect(() => formatDateTime(undefined as unknown as string)).not.toThrow();
    expect(formatDateTime(undefined as unknown as string)).toBe(""); // 缺字段缓存场景
  });

  it("formats valid ISO normally", () => {
    const out = formatDateTime("2026-08-03T10:30:00.000Z", "en");
    expect(out).toContain("Aug"); // 格式为 month day, time（无年份）
  });
});

import {
  AppState,
  AuditAction,
  AuditEvent,
  CareEvent,
  DocumentRecord,
  Member,
  NotificationPreference,
  Permission,
  Role,
  RoleNotification,
  Task
} from "./types";
import { localeForLanguage } from "./i18n";
import type { Language, Translate } from "./i18n";
import { uniqueId } from "./lib/id";

function text(
  t: Translate | undefined,
  key: string,
  fallback: string,
  values?: Record<string, string | number>
): string {
  return t ? t(key, values) : fallback;
}

export function hasPermission(state: AppState, role: Role, permission: Permission): boolean {
  return Boolean(state.roleDefinitions.find((item) => item.role === role)?.permissions.includes(permission));
}

export function isHouseholdInviteExpired(state: AppState, now: Date = new Date()): boolean {
  const expiresAt = new Date(state.household.inviteExpiresAt).getTime();
  return Number.isNaN(expiresAt) || now.getTime() >= expiresAt;
}

export function memberName(state: AppState, memberId?: string, t?: Translate): string {
  if (!memberId) {
    return text(t, "member.unassigned", "Unassigned");
  }

  const member = state.members.find((item) => item.id === memberId);
  if (!member) {
    return text(t, "member.unknown", "Unknown member");
  }

  if (member.inviteStatus === "pending") {
    return member.role === "caregiver"
      ? text(t, "member.invitedCaregiver", "New caregiver invite")
      : text(t, "member.invitedViewer", "New viewer invite");
  }

  return member.name;
}

export function formatDateTime(value: string, language: Language = "en"): string {
  return new Intl.DateTimeFormat(localeForLanguage(language), {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

export function makeAuditEvent(
  state: AppState,
  actorId: string,
  action: AuditAction,
  entityType: AuditEvent["entityType"],
  entityId: string,
  detail: string
): AuditEvent {
  return {
    id: uniqueId("audit"),
    householdId: state.household.id,
    actorId,
    action,
    entityType,
    entityId,
    createdAt: new Date().toISOString(),
    detail
  };
}

export function withAudit(
  state: AppState,
  actorId: string,
  action: AuditAction,
  entityType: AuditEvent["entityType"],
  entityId: string,
  detail: string
): AppState {
  return {
    ...state,
    auditEvents: [makeAuditEvent(state, actorId, action, entityType, entityId, detail), ...state.auditEvents]
  };
}

export function makeRoleNotification(
  audience: RoleNotification["audience"],
  severity: RoleNotification["severity"],
  titleKey: string,
  bodyKey: string,
  values: Record<string, string | number>,
  entityType: RoleNotification["entityType"],
  entityId: string
): RoleNotification {
  return {
    id: uniqueId("note"),
    audience,
    severity,
    titleKey,
    bodyKey,
    values,
    entityType,
    entityId,
    createdAt: new Date().toISOString()
  };
}

export function withRoleNotification(
  state: AppState,
  audience: RoleNotification["audience"],
  severity: RoleNotification["severity"],
  titleKey: string,
  bodyKey: string,
  values: Record<string, string | number>,
  entityType: RoleNotification["entityType"],
  entityId: string
): AppState {
  return {
    ...state,
    roleNotifications: [
      makeRoleNotification(audience, severity, titleKey, bodyKey, values, entityType, entityId),
      ...state.roleNotifications
    ]
  };
}

export function claimTask(state: AppState, taskId: string, actor: Member, t?: Translate): AppState {
  const task = state.tasks.find((item) => item.id === taskId);
  const tasks = state.tasks.map((task) =>
    task.id === taskId
      ? {
          ...task,
          status: "claimed" as const,
          ownerId: actor.id,
          rejectionReason: undefined,
          handoffToId: undefined
        }
      : task
  );

  const notified = withRoleNotification(
    { ...state, tasks },
    "coordinator",
    "info",
    "notification.title.taskClaimed",
    "notification.body.taskClaimed",
    { actor: actor.name, task: task?.title ?? text(t, "member.unknown", "Unknown") },
    "task",
    taskId
  );

  return withAudit(
    notified,
    actor.id,
    "task.claimed",
    "task",
    taskId,
    text(t, "audit.detail.task.claimed", `${actor.name} claimed responsibility for the task.`, { actor: actor.name })
  );
}

export function createTask(
  state: AppState,
  actor: Member,
  taskInput: Pick<Task, "title" | "expectedMinutes" | "dueAt" | "priority" | "subtasks">,
  t?: Translate
): AppState {
  const taskId = uniqueId("task");
  const task: Task = {
    ...taskInput,
    id: taskId,
    status: "open",
    requestedById: actor.id
  };

  const notified = withRoleNotification(
    { ...state, tasks: [task, ...state.tasks] },
    "caregiver",
    task.priority === "critical" ? "critical" : "info",
    task.priority === "critical" ? "notification.title.criticalTask" : "notification.title.newTask",
    "notification.body.claimableTask",
    { task: task.title, priority: task.priority },
    "task",
    taskId
  );

  return withAudit(
    notified,
    actor.id,
    "task.created",
    "task",
    taskId,
    text(t, "audit.detail.task.created", `${actor.name} created a claimable task.`, {
      actor: actor.name,
      title: task.title
    })
  );
}

export function rejectTask(state: AppState, taskId: string, actor: Member, t?: Translate): AppState {
  const task = state.tasks.find((item) => item.id === taskId);
  const tasks = state.tasks.map((task) =>
    task.id === taskId
      ? {
          ...task,
          status: "rejected" as const,
          ownerId: undefined,
          rejectionReason: text(t, "domain.rejectionReason", `${actor.name} cannot take this by the due time.`, {
            actor: actor.name
          })
        }
      : task
  );

  const notified = withRoleNotification(
    { ...state, tasks },
    "caregiver",
    "info",
    "notification.title.taskReturned",
    "notification.body.taskReturned",
    { actor: actor.name, task: task?.title ?? text(t, "member.unknown", "Unknown") },
    "task",
    taskId
  );

  return withAudit(
    notified,
    actor.id,
    "task.rejected",
    "task",
    taskId,
    text(t, "audit.detail.task.rejected", `${actor.name} rejected the task; it returned to the claimable pool.`, {
      actor: actor.name
    })
  );
}

export function requestHandoff(
  state: AppState,
  taskId: string,
  actor: Member,
  target: Member,
  t?: Translate
): AppState {
  const task = state.tasks.find((item) => item.id === taskId);
  const tasks = state.tasks.map((task) =>
    task.id === taskId
      ? {
          ...task,
          status: "handoff_requested" as const,
          ownerId: actor.id,
          handoffToId: target.id
        }
      : task
  );

  const notified = withRoleNotification(
    { ...state, tasks },
    target.role,
    "info",
    "notification.title.handoffRequested",
    "notification.body.handoffRequested",
    { actor: actor.name, target: target.name, task: task?.title ?? text(t, "member.unknown", "Unknown") },
    "task",
    taskId
  );

  return withAudit(
    notified,
    actor.id,
    "task.handoff_requested",
    "task",
    taskId,
    text(t, "audit.detail.task.handoff_requested", `${actor.name} requested handoff to ${target.name}.`, {
      actor: actor.name,
      target: target.name
    })
  );
}

export function completeTask(state: AppState, taskId: string, actor: Member, t?: Translate): AppState {
  const task = state.tasks.find((item) => item.id === taskId);
  const tasks = state.tasks.map((item) =>
    item.id === taskId
      ? {
          ...item,
          status: "completed" as const,
          ownerId: item.ownerId ?? actor.id,
          proof: text(t, "domain.proof", `Confirmed by ${actor.name}`, { actor: actor.name })
        }
      : item
  );

  const event: CareEvent = {
    id: uniqueId("event"),
    type: "reminder",
    title: text(t, "event.completed", `Completed: ${task?.title ?? "Task"}`, {
      title: task?.title ?? "Task"
    }),
    startsAt: new Date().toISOString(),
    location: text(t, "event.location.activity", "RelayCare activity"),
    ownerId: actor.id,
    taskId
  };

  const notified = withRoleNotification(
    { ...state, tasks, events: [event, ...state.events] },
    "coordinator",
    "info",
    "notification.title.taskCompleted",
    "notification.body.taskCompleted",
    { actor: actor.name, task: task?.title ?? text(t, "member.unknown", "Unknown") },
    "task",
    taskId
  );

  return withAudit(
    notified,
    actor.id,
    "task.completed",
    "task",
    taskId,
    text(t, "audit.detail.task.completed", `${actor.name} marked the task complete with lightweight proof.`, {
      actor: actor.name
    })
  );
}

export function addTimelineEvent(
  state: AppState,
  actor: Member,
  eventInput: Pick<CareEvent, "type" | "title" | "startsAt" | "location">,
  t?: Translate
): AppState {
  const eventId = uniqueId("event");
  const event: CareEvent = {
    id: eventId,
    ...eventInput,
    ownerId: actor.id
  };

  const notified = withRoleNotification(
    { ...state, events: [event, ...state.events] },
    "coordinator",
    "info",
    "notification.title.timelineAdded",
    "notification.body.timelineAdded",
    { actor: actor.name, event: event.title },
    "timeline",
    eventId
  );

  return withAudit(
    notified,
    actor.id,
    "timeline.event_added",
    "timeline",
    eventId,
    text(t, "audit.detail.timeline.event_added", `${actor.name} added a coordination timeline update.`, {
      actor: actor.name,
      title: event.title
    })
  );
}

export function toggleDigest(state: AppState, memberId: string, actor: Member, t?: Translate): AppState {
  const notificationPreferences: NotificationPreference[] = state.notificationPreferences.map((pref) =>
    pref.memberId === memberId ? { ...pref, taskDigest: !pref.taskDigest } : pref
  );

  return withAudit(
    { ...state, notificationPreferences },
    actor.id,
    "notification.preference_updated",
    "notification",
    memberId,
    text(
      t,
      "audit.detail.notification.preference_updated",
      "Updated non-critical task digest preference; critical due alerts remain enabled."
    )
  );
}

export function updateMemberRole(
  state: AppState,
  memberId: string,
  nextRole: Role,
  actor: Member,
  t?: Translate
): AppState {
  const target = state.members.find((member) => member.id === memberId);
  const members = state.members.map((member) => (member.id === memberId ? { ...member, role: nextRole } : member));

  const notified = withRoleNotification(
    { ...state, members },
    nextRole,
    "info",
    "notification.title.roleUpdated",
    "notification.body.roleUpdated",
    { target: target?.name ?? text(t, "member.unknown", "Unknown"), role: text(t, `role.${nextRole}`, nextRole) },
    "member",
    memberId
  );

  return withAudit(
    notified,
    actor.id,
    "member.role_updated",
    "member",
    memberId,
    text(t, "audit.detail.member.role_updated", `${actor.name} changed ${target?.name ?? "member"} to ${nextRole}.`, {
      actor: actor.name,
      target: target?.name ?? "member",
      role: text(t, `role.${nextRole}`, nextRole)
    })
  );
}

export function inviteMember(state: AppState, actor: Member, role: Role, t?: Translate): AppState {
  const memberId = uniqueId("member");
  const member: Member = {
    id: memberId,
    // Store a language-neutral sentinel; display is derived from role at render time.
    name: role === "caregiver" ? "New caregiver invite" : "New viewer invite",
    relation: "Pending invite",
    role,
    timezone: state.household.timezone,
    availability: "Pending setup",
    inviteStatus: "pending"
  };
  const preference: NotificationPreference = {
    memberId,
    emailEnabled: false,
    pushEnabled: false,
    quietHoursStart: "21:00",
    quietHoursEnd: "07:00",
    taskDigest: true,
    criticalDueAlerts: true
  };

  const withMember = {
    ...state,
    members: [...state.members, member],
    notificationPreferences: [...state.notificationPreferences, preference]
  };

  const notified = withRoleNotification(
    withMember,
    role,
    "info",
    "notification.title.memberInvited",
    "notification.body.memberInvited",
    { actor: actor.name, role: text(t, `role.${role}`, role) },
    "member",
    memberId
  );

  return withAudit(
    notified,
    actor.id,
    "member.invited",
    "member",
    memberId,
    text(t, "audit.detail.member.invited", `${actor.name} created a pending ${role} invite.`, {
      actor: actor.name,
      role: text(t, `role.${role}`, role)
    })
  );
}

export function addDocument(
  state: AppState,
  actor: Member,
  name: string,
  source: DocumentRecord["source"],
  t?: Translate
): AppState {
  const documentId = uniqueId("doc");
  const documentRecord: DocumentRecord = {
    id: documentId,
    name,
    uploadedById: actor.id,
    uploadedAt: new Date().toISOString(),
    status: "pending_confirmation",
    containsPhi: false,
    confidence: 0.64,
    source,
    suggestedAction: text(
      t,
      "task.dynamic.documentReview",
      "Review and decide whether this creates a family coordination task"
    )
  };

  const event: CareEvent = {
    id: uniqueId("event"),
    type: "document",
    title: text(t, "event.uploaded", `Uploaded: ${name}`, { name }),
    startsAt: documentRecord.uploadedAt,
    location: text(t, "event.location.sharedDocuments", "Shared documents"),
    ownerId: actor.id,
    documentId
  };

  const notified = withRoleNotification(
    {
      ...state,
      documents: [documentRecord, ...state.documents],
      events: [event, ...state.events]
    },
    "coordinator",
    "info",
    "notification.title.documentUploaded",
    "notification.body.documentUploaded",
    { actor: actor.name, document: name },
    "document",
    documentId
  );

  return withAudit(
    notified,
    actor.id,
    "document.uploaded",
    "document",
    documentId,
    text(
      t,
      "audit.detail.document.uploaded",
      "Uploaded non-PHI document metadata; manual confirmation is required before task creation."
    )
  );
}

export function confirmDocumentAndCreateTask(
  state: AppState,
  documentId: string,
  actor: Member,
  t?: Translate
): AppState {
  const documentRecord = state.documents.find((document) => document.id === documentId);
  const taskId = uniqueId("task");
  const task: Task = {
    id: taskId,
    title: documentRecord?.suggestedAction ?? text(t, "task.dynamic.uploadedReview", "Review uploaded document"),
    expectedMinutes: 15,
    dueAt: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
    priority: "normal",
    status: "open",
    requestedById: actor.id,
    documentId,
    subtasks: [
      text(t, "task.dynamic.subtask.0", "Review extracted candidate"),
      text(t, "task.dynamic.subtask.1", "Confirm action wording"),
      text(t, "task.dynamic.subtask.2", "Assign owner")
    ]
  };

  const documents = state.documents.map((document) =>
    document.id === documentId ? { ...document, status: "confirmed" as const } : document
  );

  const notified = withRoleNotification(
    { ...state, documents, tasks: [task, ...state.tasks] },
    "caregiver",
    "info",
    "notification.title.documentTask",
    "notification.body.documentTask",
    { task: task.title },
    "task",
    taskId
  );

  const audited = withAudit(
    notified,
    actor.id,
    "document.confirmed",
    "document",
    documentId,
    text(t, "audit.detail.document.confirmed", "Confirmed document candidate fields manually.")
  );

  return withAudit(
    audited,
    actor.id,
    "document.task_created",
    "task",
    taskId,
    text(
      t,
      "audit.detail.document.task_created",
      "Created a claimable coordination task from confirmed document metadata."
    )
  );
}

import { AppState } from "./types";

export const initialState: AppState = {
  household: {
    id: "hh-chen",
    name: "Chen Family Care Circle",
    timezone: "America/Los_Angeles",
    inviteExpiresAt: "2026-07-24T08:30:00-07:00",
    careRecipientLabel: "Care recipient",
    plusPlan: "free"
  },
  members: [
    {
      id: "m-maya",
      name: "Maya Chen",
      relation: "Primary caregiver",
      role: "coordinator",
      timezone: "America/Los_Angeles",
      availability: "Weekdays after 5 PM"
    },
    {
      id: "m-eli",
      name: "Eli Chen",
      relation: "Remote sibling",
      role: "caregiver",
      timezone: "America/New_York",
      availability: "Mornings and Sunday planning"
    },
    {
      id: "m-sam",
      name: "Sam Rivera",
      relation: "Neighbor helper",
      role: "caregiver",
      timezone: "America/Los_Angeles",
      availability: "Transport on Tue/Thu"
    },
    {
      id: "m-lee",
      name: "Aunt Lee",
      relation: "Read-only relative",
      role: "viewer",
      timezone: "America/Chicago",
      availability: "Weekly updates"
    }
  ],
  roleDefinitions: [
    {
      role: "coordinator",
      label: "Coordinator",
      permissions: [
        "household:manage",
        "member:invite",
        "member:role_update",
        "task:create",
        "task:claim",
        "task:handoff",
        "task:complete",
        "timeline:read",
        "timeline:add",
        "document:upload",
        "document:read",
        "report:export",
        "audit:read"
      ]
    },
    {
      role: "caregiver",
      label: "Caregiver",
      permissions: [
        "task:create",
        "task:claim",
        "task:handoff",
        "task:complete",
        "timeline:read",
        "timeline:add",
        "document:upload",
        "document:read",
        "report:export"
      ]
    },
    {
      role: "viewer",
      label: "Viewer",
      permissions: ["timeline:read"]
    }
  ],
  notificationPreferences: [
    {
      memberId: "m-maya",
      emailEnabled: true,
      pushEnabled: true,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
      taskDigest: true,
      criticalDueAlerts: true
    },
    {
      memberId: "m-eli",
      emailEnabled: true,
      pushEnabled: false,
      quietHoursStart: "21:00",
      quietHoursEnd: "06:00",
      taskDigest: true,
      criticalDueAlerts: true
    },
    {
      memberId: "m-sam",
      emailEnabled: false,
      pushEnabled: true,
      quietHoursStart: "20:30",
      quietHoursEnd: "07:30",
      taskDigest: false,
      criticalDueAlerts: true
    },
    {
      memberId: "m-lee",
      emailEnabled: true,
      pushEnabled: false,
      quietHoursStart: "21:00",
      quietHoursEnd: "08:00",
      taskDigest: true,
      criticalDueAlerts: true
    }
  ],
  roleNotifications: [
    {
      id: "note-critical-transport",
      audience: "caregiver",
      severity: "critical",
      titleKey: "notification.title.criticalTask",
      bodyKey: "notification.body.claimableTask",
      values: { task: "Arrange transport for follow-up appointment", priority: "critical" },
      entityType: "task",
      entityId: "t-transport",
      createdAt: "2026-07-22T08:45:00-07:00"
    },
    {
      id: "note-weekly-ready",
      audience: "coordinator",
      severity: "info",
      titleKey: "notification.title.weeklyReady",
      bodyKey: "notification.body.weeklyReady",
      values: { count: 3 },
      entityType: "report",
      entityId: "weekly-summary",
      createdAt: "2026-07-22T09:05:00-07:00"
    }
  ],
  tasks: [
    {
      id: "t-transport",
      title: "Arrange transport for follow-up appointment",
      expectedMinutes: 20,
      dueAt: "2026-07-23T09:00:00-07:00",
      priority: "critical",
      status: "open",
      requestedById: "m-maya",
      eventId: "e-appointment",
      subtasks: ["Confirm pickup time", "Add driver note", "Mark complete after ride is booked"]
    },
    {
      id: "t-supplies",
      title: "Pick up care supplies",
      expectedMinutes: 35,
      dueAt: "2026-07-23T18:00:00-07:00",
      priority: "normal",
      status: "claimed",
      ownerId: "m-sam",
      requestedById: "m-maya",
      subtasks: ["Check shared list", "Upload receipt or short note"]
    },
    {
      id: "t-call",
      title: "Call clinic to confirm appointment paperwork",
      expectedMinutes: 15,
      dueAt: "2026-07-24T12:00:00-07:00",
      priority: "normal",
      status: "open",
      requestedById: "m-maya",
      eventId: "e-paperwork",
      subtasks: ["Ask what documents are needed", "Add result to timeline"]
    }
  ],
  events: [
    {
      id: "e-appointment",
      type: "appointment",
      title: "Follow-up appointment",
      startsAt: "2026-07-24T10:30:00-07:00",
      location: "Clinic - address hidden in this demo",
      ownerId: "m-maya",
      taskId: "t-transport"
    },
    {
      id: "e-visit",
      type: "visit",
      title: "Evening check-in visit",
      startsAt: "2026-07-22T18:30:00-07:00",
      location: "Home",
      ownerId: "m-sam"
    },
    {
      id: "e-paperwork",
      type: "document",
      title: "Paperwork confirmation needed",
      startsAt: "2026-07-23T15:00:00-07:00",
      location: "Shared documents",
      taskId: "t-call"
    }
  ],
  documents: [
    {
      id: "d-discharge",
      name: "Sample discharge checklist - redacted.pdf",
      uploadedById: "m-maya",
      uploadedAt: "2026-07-22T08:15:00-07:00",
      status: "pending_confirmation",
      containsPhi: false,
      confidence: 0.72,
      source: "sample",
      suggestedAction: "Confirm paperwork requirements for the follow-up appointment",
      sizeBytes: 0
    }
  ],
  auditEvents: [
    {
      id: "a-001",
      householdId: "hh-chen",
      actorId: "m-maya",
      action: "household.created",
      entityType: "household",
      entityId: "hh-chen",
      createdAt: "2026-07-22T08:00:00-07:00",
      detail: "Created household with non-PHI mode enabled."
    },
    {
      id: "a-002",
      householdId: "hh-chen",
      actorId: "m-maya",
      action: "member.invited",
      entityType: "member",
      entityId: "m-eli",
      createdAt: "2026-07-22T08:02:00-07:00",
      detail: "Invite generated with 48-hour expiry."
    },
    {
      id: "a-003",
      householdId: "hh-chen",
      actorId: "m-sam",
      action: "task.claimed",
      entityType: "task",
      entityId: "t-supplies",
      createdAt: "2026-07-22T08:40:00-07:00",
      detail: "Sam Rivera claimed supply pickup."
    },
    {
      id: "a-004",
      householdId: "hh-chen",
      actorId: "m-maya",
      action: "document.uploaded",
      entityType: "document",
      entityId: "d-discharge",
      createdAt: "2026-07-22T08:15:00-07:00",
      detail: "Uploaded redacted sample document; manual confirmation required."
    }
  ]
};

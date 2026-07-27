export type Role = "coordinator" | "caregiver" | "viewer";
export type NotificationAudience = Role | "all";

export type Permission =
  | "household:manage"
  | "member:invite"
  | "member:role_update"
  | "task:create"
  | "task:claim"
  | "task:handoff"
  | "task:complete"
  | "timeline:read"
  | "timeline:add"
  | "document:upload"
  | "document:read"
  | "report:export"
  | "audit:read";

export type TaskStatus = "open" | "claimed" | "handoff_requested" | "rejected" | "completed";

export type EventType = "appointment" | "transport" | "visit" | "reminder" | "document";

export type DocumentStatus = "uploaded" | "pending_confirmation" | "confirmed";

export type AuditAction =
  | "household.created"
  | "member.invited"
  | "member.role_updated"
  | "task.created"
  | "task.claimed"
  | "task.rejected"
  | "task.handoff_requested"
  | "task.completed"
  | "timeline.event_added"
  | "notification.preference_updated"
  | "document.uploaded"
  | "document.confirmed"
  | "document.task_created"
  | "report.generated";

export type Plan = "free" | "monthly" | "yearly";

export interface Household {
  id: string;
  name: string;
  timezone: string;
  inviteExpiresAt: string;
  careRecipientLabel: string;
  plusPlan: Plan;
  plusUntil?: string;
  plusOwnerId?: string;
}

export interface NotificationPreference {
  memberId: string;
  emailEnabled: boolean;
  pushEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  taskDigest: boolean;
  criticalDueAlerts: true;
}

export interface RoleNotification {
  id: string;
  audience: NotificationAudience;
  severity: "info" | "critical";
  titleKey: string;
  bodyKey: string;
  values: Record<string, string | number>;
  entityType: "task" | "document" | "report" | "member" | "household" | "timeline";
  entityId: string;
  createdAt: string;
}

export interface Member {
  id: string;
  name: string;
  relation: string;
  role: Role;
  timezone: string;
  availability: string;
  inviteStatus?: "active" | "pending";
  inviteExpiresAt?: string;
  userId?: string | null;
}

export interface RoleDefinition {
  role: Role;
  label: string;
  permissions: Permission[];
}

export interface Task {
  id: string;
  title: string;
  expectedMinutes: number;
  dueAt: string;
  priority: "normal" | "critical";
  status: TaskStatus;
  ownerId?: string;
  requestedById: string;
  eventId?: string;
  documentId?: string;
  subtasks: string[];
  proof?: string;
  rejectionReason?: string;
  handoffToId?: string;
}

export interface CareEvent {
  id: string;
  type: EventType;
  title: string;
  startsAt: string;
  location: string;
  ownerId?: string;
  taskId?: string;
  documentId?: string;
}

export interface DocumentRecord {
  id: string;
  name: string;
  uploadedById: string;
  uploadedAt: string;
  status: DocumentStatus;
  containsPhi: false;
  confidence: number;
  source: "manual_upload" | "sample";
  suggestedAction?: string;
  storagePath?: string;
  sizeBytes: number;
}

export interface AuditEvent {
  id: string;
  householdId: string;
  actorId: string;
  action: AuditAction;
  entityType: "household" | "member" | "task" | "timeline" | "notification" | "document" | "report";
  entityId: string;
  createdAt: string;
  detail: string;
}

export interface AppState {
  household: Household;
  members: Member[];
  roleDefinitions: RoleDefinition[];
  notificationPreferences: NotificationPreference[];
  roleNotifications: RoleNotification[];
  tasks: Task[];
  events: CareEvent[];
  documents: DocumentRecord[];
  auditEvents: AuditEvent[];
}

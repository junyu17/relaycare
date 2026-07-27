import { supabase } from "./supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type {
  AppState,
  Household,
  Member,
  RoleDefinition,
  NotificationPreference,
  RoleNotification,
  Task,
  CareEvent,
  DocumentRecord,
  AuditEvent,
  Permission,
  Role
} from "../types";

// ============ DB 行类型（snake_case）-> App 类型（camelCase）映射 ============

interface DBHousehold {
  id: string;
  name: string;
  timezone: string;
  invite_expires_at: string;
  care_recipient_label: string;
  plus_plan: "free" | "monthly" | "yearly";
  plus_until: string | null;
  plus_owner_id: string | null;
}
interface DBMember {
  id: string;
  household_id: string;
  user_id: string | null;
  name: string;
  relation: string;
  role: Role;
  timezone: string;
  availability: string;
  invite_status: "active" | "pending";
  invite_expires_at: string | null;
}
interface DBRoleDefinition {
  role: Role;
  label: string;
  permissions: Permission[];
}
interface DBNotificationPreference {
  member_id: string;
  email_enabled: boolean;
  push_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  task_digest: boolean;
  critical_due_alerts: boolean;
}
interface DBRoleNotification {
  id: string;
  audience: string;
  severity: "info" | "critical";
  title_key: string;
  body_key: string;
  values: Record<string, string | number>;
  entity_type: RoleNotification["entityType"];
  entity_id: string;
  created_at: string;
}
interface DBTask {
  id: string;
  title: string;
  expected_minutes: number;
  due_at: string | null;
  priority: "normal" | "critical";
  status: Task["status"];
  owner_id: string | null;
  requested_by_id: string;
  event_id: string | null;
  document_id: string | null;
  subtasks: string[];
  proof: string | null;
  rejection_reason: string | null;
  handoff_to_id: string | null;
}
interface DBCareEvent {
  id: string;
  type: CareEvent["type"];
  title: string;
  starts_at: string | null;
  location: string;
  owner_id: string | null;
  task_id: string | null;
  document_id: string | null;
}
interface DBDocument {
  id: string;
  name: string;
  uploaded_by_id: string;
  uploaded_at: string;
  status: DocumentRecord["status"];
  contains_phi: boolean;
  confidence: number;
  source: DocumentRecord["source"];
  suggested_action: string | null;
  storage_path: string | null;
  size_bytes: number;
}
interface DBAuditEvent {
  id: string;
  household_id: string;
  actor_id: string;
  action: AuditEvent["action"];
  entity_type: AuditEvent["entityType"];
  entity_id: string;
  detail: string;
  created_at: string;
}

const mapHousehold = (r: DBHousehold): Household => ({
  id: r.id,
  name: r.name,
  timezone: r.timezone,
  inviteExpiresAt: r.invite_expires_at,
  careRecipientLabel: r.care_recipient_label,
  plusPlan: r.plus_plan,
  plusUntil: r.plus_until ?? undefined,
  plusOwnerId: r.plus_owner_id ?? undefined
});
const mapMember = (r: DBMember): Member => ({
  id: r.id,
  name: r.name,
  relation: r.relation,
  role: r.role,
  timezone: r.timezone,
  availability: r.availability,
  inviteStatus: r.invite_status,
  inviteExpiresAt: r.invite_expires_at ?? undefined,
  userId: r.user_id
});
const mapRoleDefinition = (r: DBRoleDefinition): RoleDefinition => ({
  role: r.role,
  label: r.label,
  permissions: r.permissions
});
const mapNotificationPreference = (r: DBNotificationPreference): NotificationPreference => ({
  memberId: r.member_id,
  emailEnabled: r.email_enabled,
  pushEnabled: r.push_enabled,
  quietHoursStart: r.quiet_hours_start,
  quietHoursEnd: r.quiet_hours_end,
  taskDigest: r.task_digest,
  criticalDueAlerts: true
});
const mapRoleNotification = (r: DBRoleNotification): RoleNotification => ({
  id: r.id,
  audience: r.audience as RoleNotification["audience"],
  severity: r.severity,
  titleKey: r.title_key,
  bodyKey: r.body_key,
  values: r.values,
  entityType: r.entity_type,
  entityId: r.entity_id,
  createdAt: r.created_at
});
const mapTask = (r: DBTask): Task => ({
  id: r.id,
  title: r.title,
  expectedMinutes: r.expected_minutes,
  dueAt: r.due_at ?? "",
  priority: r.priority,
  status: r.status,
  ownerId: r.owner_id ?? undefined,
  requestedById: r.requested_by_id,
  eventId: r.event_id ?? undefined,
  documentId: r.document_id ?? undefined,
  subtasks: r.subtasks ?? [],
  proof: r.proof ?? undefined,
  rejectionReason: r.rejection_reason ?? undefined,
  handoffToId: r.handoff_to_id ?? undefined
});
const mapCareEvent = (r: DBCareEvent): CareEvent => ({
  id: r.id,
  type: r.type,
  title: r.title,
  startsAt: r.starts_at ?? "",
  location: r.location,
  ownerId: r.owner_id ?? undefined,
  taskId: r.task_id ?? undefined,
  documentId: r.document_id ?? undefined
});
const mapDocument = (r: DBDocument): DocumentRecord => ({
  id: r.id,
  name: r.name,
  uploadedById: r.uploaded_by_id,
  uploadedAt: r.uploaded_at,
  status: r.status,
  containsPhi: false,
  confidence: r.confidence,
  source: r.source,
  suggestedAction: r.suggested_action ?? undefined,
  storagePath: r.storage_path ?? undefined,
  sizeBytes: r.size_bytes ?? 0
});
const mapAuditEvent = (r: DBAuditEvent): AuditEvent => ({
  id: r.id,
  householdId: r.household_id,
  actorId: r.actor_id,
  action: r.action,
  entityType: r.entity_type,
  entityId: r.entity_id,
  createdAt: r.created_at,
  detail: r.detail
});

// ============ 加载家庭全部数据 -> AppState ============

export async function fetchHouseholdState(householdId: string): Promise<AppState> {
  const [householdRes, membersRes, rolesRes, prefsRes, notesRes, tasksRes, eventsRes, docsRes, auditRes] =
    await Promise.all([
      supabase.from("households").select("*").eq("id", householdId).single(),
      supabase.from("members").select("*").eq("household_id", householdId),
      supabase.from("role_definitions").select("*"),
      supabase.from("notification_preferences").select("*").eq("household_id", householdId),
      supabase.from("role_notifications").select("*").eq("household_id", householdId),
      supabase.from("tasks").select("*").eq("household_id", householdId),
      supabase.from("care_events").select("*").eq("household_id", householdId),
      supabase.from("documents").select("*").eq("household_id", householdId),
      supabase
        .from("audit_events")
        .select("*")
        .eq("household_id", householdId)
        .order("created_at", { ascending: false })
    ]);

  const errors = [
    householdRes.error,
    membersRes.error,
    rolesRes.error,
    prefsRes.error,
    notesRes.error,
    tasksRes.error,
    eventsRes.error,
    docsRes.error,
    auditRes.error
  ].filter(Boolean);
  if (errors.length) {
    throw new Error(`fetchHouseholdState failed: ${errors[0]?.message}`);
  }

  return {
    household: mapHousehold(householdRes.data as DBHousehold),
    members: (membersRes.data as DBMember[]).map(mapMember),
    roleDefinitions: (rolesRes.data as DBRoleDefinition[]).map(mapRoleDefinition),
    notificationPreferences: (prefsRes.data as DBNotificationPreference[]).map(mapNotificationPreference),
    roleNotifications: (notesRes.data as DBRoleNotification[]).map(mapRoleNotification),
    tasks: (tasksRes.data as DBTask[]).map(mapTask),
    events: (eventsRes.data as DBCareEvent[]).map(mapCareEvent),
    documents: (docsRes.data as DBDocument[]).map(mapDocument),
    auditEvents: (auditRes.data as DBAuditEvent[]).map(mapAuditEvent)
  };
}

// ============ 离线缓存（断网时读本地缓存） ============

export async function cacheHouseholdState(householdId: string, state: AppState): Promise<void> {
  try {
    await AsyncStorage.setItem(`taskkin-care:household:${householdId}`, JSON.stringify(state));
  } catch {
    // best-effort cache
  }
}

export async function getCachedHouseholdState(householdId: string): Promise<AppState | null> {
  try {
    const raw = await AsyncStorage.getItem(`taskkin-care:household:${householdId}`);
    return raw ? (JSON.parse(raw) as AppState) : null;
  } catch {
    return null;
  }
}

// ============ 实时订阅：任一业务表变更 -> 触发回调（app 重新 fetch）============

export function subscribeHouseholdState(householdId: string, onChanged: () => void): RealtimeChannel {
  return supabase
    .channel(`household-${householdId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tasks", filter: `household_id=eq.${householdId}` },
      onChanged
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "members", filter: `household_id=eq.${householdId}` },
      onChanged
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "care_events", filter: `household_id=eq.${householdId}` },
      onChanged
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "documents", filter: `household_id=eq.${householdId}` },
      onChanged
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "audit_events", filter: `household_id=eq.${householdId}` },
      onChanged
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "role_notifications", filter: `household_id=eq.${householdId}` },
      onChanged
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "notification_preferences", filter: `household_id=eq.${householdId}` },
      onChanged
    )
    .subscribe();
}

// 实时订阅角色通知新增 -> 触发本地 push 通知
export function subscribeRoleNotifications(
  householdId: string,
  onNew: (notification: RoleNotification) => void
): RealtimeChannel {
  return supabase
    .channel(`role-notifications-${householdId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "role_notifications", filter: `household_id=eq.${householdId}` },
      (payload) => onNew(mapRoleNotification(payload.new as DBRoleNotification))
    )
    .subscribe();
}

// ============ RPC: 创建家庭 / 接受邀请 ============

export async function createHousehold(args: {
  householdName: string;
  timezone: string;
  careRecipientLabel: string;
  memberName: string;
  memberRelation: string;
  memberTimezone: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("create_household", {
    p_household_name: args.householdName,
    p_timezone: args.timezone,
    p_care_recipient_label: args.careRecipientLabel,
    p_member_name: args.memberName,
    p_member_relation: args.memberRelation,
    p_member_timezone: args.memberTimezone
  });
  if (error) throw error;
  return data as string;
}

export async function acceptInvite(token: string, displayName?: string): Promise<string> {
  const { data, error } = await supabase.rpc("accept_invite", {
    p_invite_token: token,
    p_display_name: displayName ?? null
  });
  if (error) throw error;
  return data as string; // 返回 household_id，避免再查一次
}

// ============ 付费墙 RPC（0008）============

// 邀请成员（原子：建 member + pref + invite token + 审计 + 通知，含成员数配额校验）。
// 返回 invite token。
export async function inviteMemberRpc(householdId: string, role: "caregiver" | "viewer"): Promise<string> {
  const { data, error } = await supabase.rpc("invite_member", {
    p_household_id: householdId,
    p_role: role
  });
  if (error) throw error;
  return data as string;
}

// 创建文档元数据（原子：单文件 25MB + OCR 月配额校验 + 插入 + 审计 + 通知）。
// 客户端先上传 storage，再调本 RPC；若 RPC 拒绝需清理已上传文件。
export async function createDocumentRpc(args: {
  householdId: string;
  name: string;
  uploadedById: string;
  source: "manual_upload" | "sample";
  sizeBytes: number;
  confidence: number;
  suggestedAction: string | null;
  storagePath: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("create_document", {
    p_household_id: args.householdId,
    p_name: args.name,
    p_uploaded_by_id: args.uploadedById,
    p_source: args.source,
    p_size_bytes: args.sizeBytes,
    p_confidence: args.confidence,
    p_suggested_action: args.suggestedAction,
    p_storage_path: args.storagePath
  });
  if (error) throw error;
  return data as string;
}

// 手动设置家庭套餐（dev/测试用；上线后由校验 Edge Function 调用）。
export async function setHouseholdPlus(
  householdId: string,
  plan: "free" | "monthly" | "yearly",
  ownerMemberId: string
): Promise<void> {
  const { error } = await supabase.rpc("set_household_plus", {
    p_household_id: householdId,
    p_plan: plan,
    p_owner_member_id: ownerMemberId
  });
  if (error) throw error;
}

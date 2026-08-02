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
  created_at: string;
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
  created_at: string;
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
  created_at: string | null;
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
  raw_text: string | null;
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

interface DBHouseholdSummary {
  id: string;
  name: string;
  care_recipient_label: string;
  role: Role;
  plus_plan: "free" | "monthly" | "yearly";
  plus_until: string | null;
  is_active: boolean;
}

export interface HouseholdSummary {
  id: string;
  name: string;
  careRecipientLabel: string;
  role: Role;
  plusPlan: "free" | "monthly" | "yearly";
  plusUntil?: string;
  isActive: boolean;
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
  createdAt: r.created_at,
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
  handoffToId: r.handoff_to_id ?? undefined,
  createdAt: r.created_at
});
const mapCareEvent = (r: DBCareEvent): CareEvent => ({
  id: r.id,
  type: r.type,
  title: r.title,
  startsAt: r.starts_at ?? "",
  location: r.location,
  ownerId: r.owner_id ?? undefined,
  taskId: r.task_id ?? undefined,
  documentId: r.document_id ?? undefined,
  createdAt: r.created_at ?? undefined
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
  sizeBytes: r.size_bytes ?? 0,
  rawText: r.raw_text ?? undefined
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
const mapHouseholdSummary = (r: DBHouseholdSummary): HouseholdSummary => ({
  id: r.id,
  name: r.name,
  careRecipientLabel: r.care_recipient_label,
  role: r.role,
  plusPlan: r.plus_plan,
  plusUntil: r.plus_until ?? undefined,
  isActive: r.is_active
});

// ============ 加载家庭全部数据 -> AppState ============

export async function fetchHouseholdState(householdId: string): Promise<AppState> {
  const [householdRes, membersRes, rolesRes, prefsRes, notesRes, tasksRes, eventsRes, docsRes, auditRes] =
    await Promise.all([
      supabase.from("households").select("*").eq("id", householdId).single(),
      supabase
        .from("members")
        .select("*")
        .eq("household_id", householdId)
        .neq("invite_status", "removed")
        .order("created_at", { ascending: true }),
      supabase.from("role_definitions").select("*"),
      supabase.from("notification_preferences").select("*").eq("household_id", householdId),
      supabase.from("role_notifications").select("*").eq("household_id", householdId),
      supabase.from("tasks").select("*").eq("household_id", householdId).order("created_at", { ascending: false }),
      supabase
        .from("care_events")
        .select("*")
        .eq("household_id", householdId)
        .order("starts_at", { ascending: true, nullsFirst: false }),
      supabase.from("documents").select("*").eq("household_id", householdId).order("uploaded_at", { ascending: false }),
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

export async function listMyHouseholds(): Promise<HouseholdSummary[]> {
  const { data, error } = await supabase.rpc("list_my_households");
  if (error) throw error;
  return ((data ?? []) as DBHouseholdSummary[]).map(mapHouseholdSummary);
}

export async function setActiveHousehold(householdId: string): Promise<void> {
  const { error } = await supabase.rpc("set_active_household", { p_household_id: householdId });
  if (error) throw error;
}

// ============ 离线缓存（断网时读本地缓存） ============

export async function cacheHouseholdState(householdId: string, state: AppState): Promise<void> {
  try {
    // I6: 缓存剔除 OCR 原文（rawText 可能含敏感内容），离线仅恢复非敏感数据；
    // 成员名/审计 detail 等保持（家庭内部成员本可见，且缓存本机）。
    const sanitized: AppState = {
      ...state,
      documents: state.documents.map((d) => ({ ...d, rawText: undefined }))
    };
    await AsyncStorage.setItem(`taskkin-care:household:${householdId}`, JSON.stringify(sanitized));
  } catch {
    // best-effort cache
  }
}

// I6: 登出时清除全部家庭缓存（含可能的敏感数据残留）。
export async function clearHouseholdCaches(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith("taskkin-care:household:")));
  } catch {
    // best-effort cleanup
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
  return (
    supabase
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
      // households 表变更（如购买后 set_household_plus 更新 plus_plan）也触发刷新。
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "households", filter: `id=eq.${householdId}` },
        onChanged
      )
      .subscribe()
  );
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
  rawText?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("create_document", {
    p_household_id: args.householdId,
    p_name: args.name,
    p_uploaded_by_id: args.uploadedById,
    p_source: args.source,
    p_size_bytes: args.sizeBytes,
    p_confidence: args.confidence,
    p_suggested_action: args.suggestedAction,
    p_storage_path: args.storagePath,
    p_raw_text: args.rawText ?? null
  });
  if (error) throw error;
  return data as string;
}

// 手动设置家庭套餐（dev/测试用；上线后由校验 Edge Function 调用）。
// 删除账号 + 家庭数据（调 delete-account Edge Function；Apple 5.1.1）。
// 成功后调用方应 signOut。
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.functions.invoke("delete-account", {});
  if (error) throw error;
}

// ============ 家庭 6 位加入码 + 成员管理（0014）============

export interface HouseholdCode {
  code: string;
  expiresAt: string;
}

// 协调人生成新码（旧码作废），返回 6 位码 + 到期时间。
export async function generateHouseholdCode(): Promise<HouseholdCode> {
  const { data, error } = await supabase.rpc("generate_household_code");
  if (error) throw error;
  const row = (data ?? []) as { code: string; expires_at: string }[];
  if (!row.length) throw new Error("Could not generate code");
  return { code: row[0].code, expiresAt: row[0].expires_at };
}

// 协调人取当前有效码（无则 null）。
export async function getHouseholdCode(): Promise<HouseholdCode | null> {
  const { data, error } = await supabase.rpc("get_household_code");
  if (error) throw error;
  const row = (data ?? []) as { code: string; expires_at: string }[];
  if (!row.length) return null;
  return { code: row[0].code, expiresAt: row[0].expires_at };
}

// 凭 6 位码加入家庭（返回 household_id）。
export async function joinByCode(code: string, displayName?: string): Promise<string> {
  const { data, error } = await supabase.rpc("join_by_code", {
    p_code: code,
    p_display_name: displayName ?? null
  });
  if (error) throw error;
  return data as string;
}

// 普通成员退出自己。
export async function leaveHousehold(householdId: string): Promise<void> {
  const { error } = await supabase.rpc("leave_household", { p_household_id: householdId });
  if (error) throw error;
}

// 协调人移除成员。
export async function removeMember(memberId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_member", { p_member_id: memberId });
  if (error) throw error;
}

// 协调人解散家庭（级联删除全部数据）。
export async function dissolveHousehold(): Promise<void> {
  const { error } = await supabase.rpc("dissolve_household");
  if (error) throw error;
}

// 成员自助修改显示名（I2: 显式传 householdId，避免多家庭上下文误改）。
export async function updateMyName(displayName: string, householdId?: string): Promise<void> {
  const { error } = await supabase.rpc("update_my_name", {
    p_display_name: displayName,
    ...(householdId ? { p_household_id: householdId } : {})
  });
  if (error) throw error;
}

// ============ 用户级通知（解散/移除；家庭删除后仍存活）============

export interface UserNotification {
  id: string;
  kind: "household_dissolved" | "removed_from_household";
  householdName: string | null;
  read: boolean;
  createdAt: string;
}

export function subscribeUserNotifications(userId: string, onNew: (n: UserNotification) => void): RealtimeChannel {
  return supabase
    .channel(`user-notifications-${userId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "user_notifications", filter: `user_id=eq.${userId}` },
      (payload) => {
        const r = payload.new as {
          id: string;
          kind: string;
          household_name: string | null;
          read: boolean;
          created_at: string;
        };
        onNew({
          id: r.id,
          kind: r.kind as UserNotification["kind"],
          householdName: r.household_name,
          read: r.read,
          createdAt: r.created_at
        });
      }
    )
    .subscribe();
}

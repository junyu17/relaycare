import { supabase } from "./supabase";
import type { Member, Role, AuditAction } from "../types";

// 写操作层：每个操作对应 domain.ts 的纯函数，但写 Supabase（而非本地 state）。
// 写成功后 Supabase Realtime 会推送变更 -> app 重新 fetch 更新本地 state（见 db.ts subscribe）。
// audit detail 用英文固定串（含动态变量），role_notifications 存 i18n key + values 供 app 渲染时翻译。

async function insertAudit(p: {
  householdId: string;
  actorId: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  detail: string;
}) {
  const { error } = await supabase.from("audit_events").insert({
    household_id: p.householdId,
    actor_id: p.actorId,
    action: p.action,
    entity_type: p.entityType,
    entity_id: p.entityId,
    detail: p.detail
  });
  if (error) throw error;
}

async function insertNotification(p: {
  householdId: string;
  audience: string;
  severity: "info" | "critical";
  titleKey: string;
  bodyKey: string;
  values: Record<string, string | number>;
  entityType: string;
  entityId: string;
}) {
  const { error } = await supabase.from("role_notifications").insert({
    household_id: p.householdId,
    audience: p.audience,
    severity: p.severity,
    title_key: p.titleKey,
    body_key: p.bodyKey,
    values: p.values,
    entity_type: p.entityType,
    entity_id: p.entityId
  });
  if (error) throw error;
}

export async function createTask(args: {
  householdId: string;
  actor: Member;
  title: string;
  expectedMinutes: number;
  dueAt: string;
  priority: "normal" | "critical";
  subtasks: string[];
  eventId?: string;
  documentId?: string;
}) {
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      household_id: args.householdId,
      title: args.title,
      expected_minutes: args.expectedMinutes,
      due_at: args.dueAt,
      priority: args.priority,
      status: "open",
      requested_by_id: args.actor.id,
      event_id: args.eventId ?? null,
      document_id: args.documentId ?? null,
      subtasks: args.subtasks
    })
    .select("id")
    .single();
  if (error) throw error;
  await insertAudit({
    householdId: args.householdId,
    actorId: args.actor.id,
    action: "task.created",
    entityType: "task",
    entityId: data.id,
    detail: `${args.actor.name} created task "${args.title}".`
  });
  await insertNotification({
    householdId: args.householdId,
    audience: "caregiver",
    severity: args.priority === "critical" ? "critical" : "info",
    titleKey: "notification.title.taskCreated",
    bodyKey: "notification.body.claimableTask",
    values: { task: args.title, priority: args.priority },
    entityType: "task",
    entityId: data.id
  });
}

export async function claimTask(args: { householdId: string; taskId: string; actor: Member; taskTitle: string }) {
  const { error } = await supabase
    .from("tasks")
    .update({ status: "claimed", owner_id: args.actor.id, handoff_to_id: null, rejection_reason: null })
    .eq("id", args.taskId);
  if (error) throw error;
  await insertAudit({
    householdId: args.householdId,
    actorId: args.actor.id,
    action: "task.claimed",
    entityType: "task",
    entityId: args.taskId,
    detail: `${args.actor.name} claimed "${args.taskTitle}".`
  });
  await insertNotification({
    householdId: args.householdId,
    audience: "coordinator",
    severity: "info",
    titleKey: "notification.title.taskClaimed",
    bodyKey: "notification.body.taskClaimed",
    values: { task: args.taskTitle, name: args.actor.name },
    entityType: "task",
    entityId: args.taskId
  });
}

export async function rejectTask(args: {
  householdId: string;
  taskId: string;
  actor: Member;
  taskTitle: string;
  reason: string;
}) {
  const { error } = await supabase
    .from("tasks")
    .update({ status: "rejected", rejection_reason: args.reason, owner_id: null })
    .eq("id", args.taskId);
  if (error) throw error;
  await insertAudit({
    householdId: args.householdId,
    actorId: args.actor.id,
    action: "task.rejected",
    entityType: "task",
    entityId: args.taskId,
    detail: `${args.actor.name} declined "${args.taskTitle}": ${args.reason}`
  });
}

export async function requestHandoff(args: {
  householdId: string;
  taskId: string;
  actor: Member;
  target: Member;
  taskTitle: string;
}) {
  const { error } = await supabase
    .from("tasks")
    .update({ status: "handoff_requested", handoff_to_id: args.target.id })
    .eq("id", args.taskId);
  if (error) throw error;
  await insertAudit({
    householdId: args.householdId,
    actorId: args.actor.id,
    action: "task.handoff_requested",
    entityType: "task",
    entityId: args.taskId,
    detail: `${args.actor.name} requested handoff of "${args.taskTitle}" to ${args.target.name}.`
  });
  await insertNotification({
    householdId: args.householdId,
    audience: args.target.role,
    severity: "info",
    titleKey: "notification.title.handoffRequested",
    bodyKey: "notification.body.handoffRequested",
    values: { task: args.taskTitle, name: args.target.name },
    entityType: "task",
    entityId: args.taskId
  });
}

export async function completeTask(args: {
  householdId: string;
  taskId: string;
  actor: Member;
  taskTitle: string;
  proof: string;
}) {
  const { error } = await supabase
    .from("tasks")
    .update({ status: "completed", proof: args.proof })
    .eq("id", args.taskId);
  if (error) throw error;
  await insertAudit({
    householdId: args.householdId,
    actorId: args.actor.id,
    action: "task.completed",
    entityType: "task",
    entityId: args.taskId,
    detail: `${args.actor.name} completed "${args.taskTitle}".`
  });
  await insertNotification({
    householdId: args.householdId,
    audience: "coordinator",
    severity: "info",
    titleKey: "notification.title.taskCompleted",
    bodyKey: "notification.body.taskCompleted",
    values: { task: args.taskTitle, name: args.actor.name },
    entityType: "task",
    entityId: args.taskId
  });
}

export async function addTimelineEvent(args: {
  householdId: string;
  actor: Member;
  type: string;
  title: string;
  startsAt: string;
  location: string;
}) {
  const { data, error } = await supabase
    .from("care_events")
    .insert({
      household_id: args.householdId,
      type: args.type,
      title: args.title,
      starts_at: args.startsAt,
      location: args.location,
      owner_id: args.actor.id
    })
    .select("id")
    .single();
  if (error) throw error;
  await insertAudit({
    householdId: args.householdId,
    actorId: args.actor.id,
    action: "timeline.event_added",
    entityType: "timeline",
    entityId: data.id,
    detail: `${args.actor.name} added timeline event "${args.title}".`
  });
  await insertNotification({
    householdId: args.householdId,
    audience: "coordinator",
    severity: "info",
    titleKey: "notification.title.timelineAdded",
    bodyKey: "notification.body.timelineAdded",
    values: { title: args.title, name: args.actor.name },
    entityType: "timeline",
    entityId: data.id
  });
}

export async function toggleDigest(args: { householdId: string; actor: Member; memberId: string; enabled: boolean }) {
  const { error } = await supabase
    .from("notification_preferences")
    .update({ task_digest: args.enabled })
    .eq("member_id", args.memberId);
  if (error) throw error;
  await insertAudit({
    householdId: args.householdId,
    actorId: args.actor.id,
    action: "notification.preference_updated",
    entityType: "notification",
    entityId: args.memberId,
    detail: `${args.actor.name} ${args.enabled ? "enabled" : "disabled"} task digest for member ${args.memberId}.`
  });
}

export async function updateMemberRole(args: {
  householdId: string;
  actor: Member;
  memberId: string;
  memberName: string;
  role: Role;
}) {
  const { error } = await supabase.from("members").update({ role: args.role }).eq("id", args.memberId);
  if (error) throw error;
  await insertAudit({
    householdId: args.householdId,
    actorId: args.actor.id,
    action: "member.role_updated",
    entityType: "member",
    entityId: args.memberId,
    detail: `${args.actor.name} changed ${args.memberName}'s role to ${args.role}.`
  });
  await insertNotification({
    householdId: args.householdId,
    audience: args.role,
    severity: "info",
    titleKey: "notification.title.roleUpdated",
    bodyKey: "notification.body.roleUpdated",
    values: { name: args.memberName, role: args.role },
    entityType: "member",
    entityId: args.memberId
  });
}

export async function inviteMember(args: { householdId: string; actor: Member; role: Role; householdName: string }) {
  const inviteName = args.role === "caregiver" ? "New caregiver invite" : "New viewer invite";
  const { data, error } = await supabase
    .from("members")
    .insert({
      household_id: args.householdId,
      name: inviteName,
      role: args.role,
      invite_status: "pending",
      invite_expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
    })
    .select("id")
    .single();
  if (error) throw error;
  await supabase.from("notification_preferences").insert({ household_id: args.householdId, member_id: data.id });
  await insertAudit({
    householdId: args.householdId,
    actorId: args.actor.id,
    action: "member.invited",
    entityType: "member",
    entityId: data.id,
    detail: `${args.actor.name} invited a new ${args.role} to ${args.householdName}.`
  });
  await insertNotification({
    householdId: args.householdId,
    audience: args.role,
    severity: "info",
    titleKey: "notification.title.memberInvited",
    bodyKey: "notification.body.memberInvited",
    values: { role: args.role },
    entityType: "member",
    entityId: data.id
  });
  return data.id; // 邀请 member id，用于生成邀请链接
}

export async function addDocument(args: {
  householdId: string;
  actor: Member;
  name: string;
  source: "manual_upload" | "sample";
  confidence: number;
  suggestedAction?: string;
  fileBody?: Blob;
  storagePath?: string;
}) {
  if (args.fileBody && args.storagePath) {
    const { error: upErr } = await supabase.storage.from("documents").upload(args.storagePath, args.fileBody);
    if (upErr) throw upErr;
  }
  const { data, error } = await supabase
    .from("documents")
    .insert({
      household_id: args.householdId,
      name: args.name,
      uploaded_by_id: args.actor.id,
      status: "pending_confirmation",
      contains_phi: false,
      confidence: args.confidence,
      source: args.source,
      suggested_action: args.suggestedAction ?? null,
      storage_path: args.storagePath ?? null
    })
    .select("id")
    .single();
  if (error) throw error;
  await insertAudit({
    householdId: args.householdId,
    actorId: args.actor.id,
    action: "document.uploaded",
    entityType: "document",
    entityId: data.id,
    detail: `${args.actor.name} uploaded "${args.name}"; manual confirmation required.`
  });
  return data.id;
}

export async function confirmDocumentAndCreateTask(args: {
  householdId: string;
  actor: Member;
  documentId: string;
  documentName: string;
  taskTitle: string;
  dueAt: string;
  subtasks: string[];
}) {
  const { error: docErr } = await supabase.from("documents").update({ status: "confirmed" }).eq("id", args.documentId);
  if (docErr) throw docErr;
  const { data: task, error: taskErr } = await supabase
    .from("tasks")
    .insert({
      household_id: args.householdId,
      title: args.taskTitle,
      expected_minutes: 15,
      due_at: args.dueAt,
      priority: "normal",
      status: "open",
      requested_by_id: args.actor.id,
      document_id: args.documentId,
      subtasks: args.subtasks
    })
    .select("id")
    .single();
  if (taskErr) throw taskErr;
  await insertAudit({
    householdId: args.householdId,
    actorId: args.actor.id,
    action: "document.confirmed",
    entityType: "document",
    entityId: args.documentId,
    detail: `${args.actor.name} confirmed document "${args.documentName}".`
  });
  await insertAudit({
    householdId: args.householdId,
    actorId: args.actor.id,
    action: "document.task_created",
    entityType: "task",
    entityId: task.id,
    detail: `${args.actor.name} created task "${args.taskTitle}" from document "${args.documentName}".`
  });
  await insertNotification({
    householdId: args.householdId,
    audience: "caregiver",
    severity: "info",
    titleKey: "notification.title.taskCreated",
    bodyKey: "notification.body.claimableTask",
    values: { task: args.taskTitle, priority: "normal" },
    entityType: "task",
    entityId: task.id
  });
}

export async function recordReportGenerated(args: { householdId: string; actor: Member; openCount: number }) {
  const { data, error } = await supabase
    .from("role_notifications")
    .insert({
      household_id: args.householdId,
      audience: "coordinator",
      severity: "info",
      title_key: "notification.title.weeklyReady",
      body_key: "notification.body.weeklyReady",
      values: { count: args.openCount },
      entity_type: "report",
      entity_id: "weekly-summary"
    })
    .select("id")
    .single();
  if (error) throw error;
  await insertAudit({
    householdId: args.householdId,
    actorId: args.actor.id,
    action: "report.generated",
    entityType: "report",
    entityId: data.id,
    detail: `${args.actor.name} generated the weekly family report.`
  });
}

import { supabase } from "./supabase";
import { getOcrProvider } from "./ocr";
import { inviteMemberRpc, createDocumentRpc } from "./db";
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
  const { error } = await supabase.rpc("create_task_with_activity", {
    p_household_id: args.householdId,
    p_title: args.title,
    p_expected_minutes: args.expectedMinutes,
    p_due_at: args.dueAt,
    p_priority: args.priority,
    p_subtasks: args.subtasks,
    p_event_id: args.eventId ?? null,
    p_document_id: args.documentId ?? null
  });
  if (error) throw error;
}

export async function claimTask(args: { householdId: string; taskId: string; actor: Member; taskTitle: string }) {
  const { error } = await supabase.rpc("transition_task_with_activity", {
    p_task_id: args.taskId,
    p_action: "claim"
  });
  if (error) throw error;
}

export async function rejectTask(args: {
  householdId: string;
  taskId: string;
  actor: Member;
  taskTitle: string;
  reason: string;
}) {
  const { error } = await supabase.rpc("transition_task_with_activity", {
    p_task_id: args.taskId,
    p_action: "reject",
    p_rejection_reason: args.reason
  });
  if (error) throw error;
}

export async function requestHandoff(args: {
  householdId: string;
  taskId: string;
  actor: Member;
  target: Member;
  taskTitle: string;
}) {
  const { error } = await supabase.rpc("transition_task_with_activity", {
    p_task_id: args.taskId,
    p_action: "handoff",
    p_handoff_to_id: args.target.id
  });
  if (error) throw error;
}

export async function deleteTask(args: { taskId: string }) {
  const { error } = await supabase.rpc("delete_task", { p_task_id: args.taskId });
  if (error) throw error;
}

export async function deleteCareEvent(args: { eventId: string }) {
  const { error } = await supabase.rpc("delete_care_event", { p_event_id: args.eventId });
  if (error) throw error;
}

export async function completeTask(args: {
  householdId: string;
  taskId: string;
  actor: Member;
  taskTitle: string;
  proof: string;
}) {
  const { error } = await supabase.rpc("transition_task_with_activity", {
    p_task_id: args.taskId,
    p_action: "complete",
    p_proof: args.proof
  });
  if (error) throw error;
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
  const { error } = await supabase.rpc("update_member_role", {
    p_member_id: args.memberId,
    p_role: args.role
  });
  if (error) throw error;
}

export async function inviteMember(args: { householdId: string; actor: Member; role: Role; householdName: string }) {
  if (args.role !== "caregiver" && args.role !== "viewer") {
    throw new Error("Only caregiver or viewer can be invited");
  }
  // 原子 RPC：建 member + pref + invite token + 审计 + 通知，含成员数配额校验。返回 invite token。
  return inviteMemberRpc(args.householdId, args.role);
}

export async function addDocument(args: {
  householdId: string;
  actor: Member;
  name: string;
  source: "manual_upload" | "sample";
  fileUri?: string;
  fileBody?: Blob;
  storagePath?: string;
}) {
  if (args.fileBody && args.storagePath) {
    const { error: upErr } = await supabase.storage.from("documents").upload(args.storagePath, args.fileBody);
    if (upErr) throw upErr;
  }
  // OCR 候选字段 + 置信度。试点期 mock（演示值）；试点后 device；兜底 cloud（见 lib/ocr）。
  const ocr = await getOcrProvider().extract({
    fileUri: args.fileUri,
    fileBody: args.fileBody,
    fileName: args.name,
    source: args.source
  });
  const sizeBytes = args.fileBody ? args.fileBody.size : 0;
  try {
    // 原子 RPC：单文件 25MB + OCR 月配额校验 + 插入 + 审计 + 通知。返回 document id。
    return await createDocumentRpc({
      householdId: args.householdId,
      name: args.name,
      uploadedById: args.actor.id,
      source: args.source,
      sizeBytes,
      confidence: ocr.confidence,
      suggestedAction: ocr.suggestedAction ?? null,
      storagePath: args.storagePath ?? null,
      rawText: ocr.rawText ?? null
    });
  } catch (e) {
    // RPC 拒绝（配额/大小）或失败 -> 清理已上传的孤儿文件。
    if (args.fileBody && args.storagePath) {
      await supabase.storage
        .from("documents")
        .remove([args.storagePath])
        .catch(() => {});
    }
    throw e;
  }
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
  // B7: 原子化——服务端 security definer RPC（迁移 0029_confirm_document_atomic.sql）
  // 单事务完成 document 确认 + task 创建 + 审计 + 通知。家庭/actor 由服务端从
  // auth.uid() 与 document 所属家庭推导，不再信任客户端传入的 householdId/actor。
  const { data, error } = await supabase.rpc("confirm_document_and_create_task", {
    p_document_id: args.documentId,
    p_task_title: args.taskTitle,
    p_due_at: args.dueAt,
    p_subtasks: args.subtasks
  });
  if (error) throw error;
  return data as string;
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

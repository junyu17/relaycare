-- 0045: Bug1 删除同步 + Bug2 重复提交防护（2026-08-03 用户报告）
--
-- Bug1 根因：tasks/care_events 硬删（0017），但全库未设 REPLICA IDENTITY FULL →
-- Realtime DELETE 事件 WAL 仅含主键，household_id=null → 订阅 filter 不匹配 → 事件被丢，
-- 所有设备（含删除方）不触发 refetch → 删除不同步（members 软删因此正常）。
-- 修复：对会被硬删且按 household 订阅的表设置 FULL，DELETE 事件带出整行，filter 可匹配。

alter table public.tasks replica identity full;
alter table public.care_events replica identity full;
alter table public.documents replica identity full;
alter table public.audit_events replica identity full;
-- 注：members/households/role_notifications 走 UPDATE/INSERT 事件（新值完整），无需 FULL。

-- Bug2 根因：创建入口无幂等，RPC 裸 insert + 客户端直插，连点产生重复任务/事件。
-- 修复：client_request_id 幂等键（请求方 + 客户端生成 id 唯一）+ 重复时返回/忽略。

alter table public.tasks add column client_request_id uuid;
create unique index tasks_request_dedup_idx on public.tasks (requested_by_id, client_request_id)
  where client_request_id is not null;

alter table public.care_events add column client_request_id uuid;
create unique index care_events_request_dedup_idx on public.care_events (owner_id, client_request_id)
  where owner_id is not null and client_request_id is not null;

-- create_task_with_activity 幂等：同一请求方 + 同一 client_request_id 重复调用返回已有任务。
create or replace function public.create_task_with_activity(
  p_household_id uuid, p_title text, p_expected_minutes integer, p_due_at timestamptz,
  p_priority text, p_subtasks jsonb default '[]'::jsonb, p_event_id uuid default null,
  p_document_id uuid default null, p_client_request_id uuid default null
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_task_id uuid;
  v_actor_id uuid := public.current_member_id();
  v_actor_name text;
begin
  if v_actor_id is null or not public.can_coordinate_work() then raise exception 'Task creation is not permitted'; end if;
  if p_client_request_id is not null then
    select id into v_task_id from public.tasks
      where requested_by_id = v_actor_id and client_request_id = p_client_request_id;
    if v_task_id is not null then return v_task_id; end if;
  end if;
  select name into v_actor_name from public.members where id = v_actor_id;
  insert into public.tasks (household_id, title, expected_minutes, due_at, priority, status, requested_by_id, event_id, document_id, subtasks, client_request_id)
  values (p_household_id, p_title, p_expected_minutes, p_due_at, p_priority, 'open', v_actor_id, p_event_id, p_document_id, coalesce(p_subtasks, '[]'::jsonb), p_client_request_id)
  returning id into v_task_id;
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (p_household_id, v_actor_id, 'task.created', 'task', v_task_id::text, format('%s created task "%s".', v_actor_name, p_title));
  insert into public.role_notifications (household_id, audience, severity, title_key, body_key, values, entity_type, entity_id)
  values (p_household_id, 'caregiver', case when p_priority = 'critical' then 'critical' else 'info' end,
    case when p_priority = 'critical' then 'notification.title.criticalTask' else 'notification.title.newTask' end,
    'notification.body.claimableTask', jsonb_build_object('task', p_title, 'priority', p_priority), 'task', v_task_id::text);
  return v_task_id;
end;
$$;

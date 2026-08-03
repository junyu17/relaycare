-- 0047: R4 review warn 修复
-- 1) RPC 幂等改原子（insert ... on conflict do nothing），消除 select-then-insert 并发 23505
-- 2) households 也设 FULL（解散家庭硬删场景，订阅 filter id=eq 需匹配 DELETE 事件）

alter table public.households replica identity full;

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
  -- 原子幂等：同 key 并发重复调用只会有一个插入成功，另一个走 do nothing 后重查。
  insert into public.tasks (household_id, title, expected_minutes, due_at, priority, status, requested_by_id, event_id, document_id, subtasks, client_request_id)
  values (p_household_id, p_title, p_expected_minutes, p_due_at, p_priority, 'open', v_actor_id, p_event_id, p_document_id, coalesce(p_subtasks, '[]'::jsonb), p_client_request_id)
  on conflict (requested_by_id, client_request_id) do nothing
  returning id into v_task_id;
  if v_task_id is null then
    -- 重复提交（含并发竞争）：返回已有任务，不再写审计/通知。
    select id into v_task_id from public.tasks
      where requested_by_id = v_actor_id and client_request_id = p_client_request_id;
    return v_task_id;
  end if;
  select name into v_actor_name from public.members where id = v_actor_id;
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (p_household_id, v_actor_id, 'task.created', 'task', v_task_id::text, format('%s created task "%s".', v_actor_name, p_title));
  insert into public.role_notifications (household_id, audience, severity, title_key, body_key, values, entity_type, entity_id)
  values (p_household_id, 'caregiver', case when p_priority = 'critical' then 'critical' else 'info' end,
    case when p_priority = 'critical' then 'notification.title.criticalTask' else 'notification.title.newTask' end,
    'notification.body.claimableTask', jsonb_build_object('task', p_title, 'priority', p_priority), 'task', v_task_id::text);
  return v_task_id;
end;
$$;

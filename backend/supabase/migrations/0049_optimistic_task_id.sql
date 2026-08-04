-- 0049: SYNC_FIX_REVIEW P1 —— 任务乐观插入允许客户端指定主键
-- 客户端乐观行与服务端行 id 相同 → refetch 原地替换，不闪烁、无 list key 抖动。
-- 其余分支（幂等回查/审计/通知）与 0047 逐字一致，一行未改。
create or replace function public.create_task_with_activity(
  p_household_id uuid, p_title text, p_expected_minutes integer, p_due_at timestamptz,
  p_priority text, p_subtasks jsonb default '[]'::jsonb, p_event_id uuid default null,
  p_document_id uuid default null, p_client_request_id uuid default null,
  p_task_id uuid default null                                    -- 新增，末位保持向后兼容
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_task_id uuid;
  v_actor_id uuid := public.current_member_id();
  v_actor_name text;
begin
  if v_actor_id is null or not public.can_coordinate_work() then raise exception 'Task creation is not permitted'; end if;
  insert into public.tasks (id, household_id, title, expected_minutes, due_at, priority, status, requested_by_id, event_id, document_id, subtasks, client_request_id)
  values (coalesce(p_task_id, gen_random_uuid()), p_household_id, p_title, p_expected_minutes, p_due_at, p_priority, 'open', v_actor_id, p_event_id, p_document_id, coalesce(p_subtasks, '[]'::jsonb), p_client_request_id)
  on conflict (requested_by_id, client_request_id) do nothing
  returning id into v_task_id;
  if v_task_id is null then
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

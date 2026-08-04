-- 0051: 0050 修正（最高标准清零）——TASK_ID_TAKEN 用 unique_violation 捕获：
--  1) 跨家庭 id 占用（唯一约束不经过 RLS，exists 探测查不到）→ 统一业务错误，无裸 23505 oracle；
--  2) 消除 exists→insert TOCTOU；
--  3) 幂等回查前置（0047/0049 契约：同请求方同 request id 重试返回已有任务），
--     并发幂等撞唯一键时在 exception 分支回查返回，而非误报 TASK_ID_TAKEN。
create or replace function public.create_task_with_activity(
  p_household_id uuid, p_title text, p_expected_minutes integer, p_due_at timestamptz,
  p_priority text, p_subtasks jsonb default '[]'::jsonb, p_event_id uuid default null,
  p_document_id uuid default null, p_client_request_id uuid default null,
  p_task_id uuid default null
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_task_id uuid;
  v_actor_id uuid := public.current_member_id();
  v_actor_name text;
begin
  if v_actor_id is null or not public.can_coordinate_work() then raise exception 'Task creation is not permitted'; end if;
  -- 幂等回查前置（契约）：同请求方同 request id 已存在 → 返回已有任务，不重复写审计/通知。
  if p_client_request_id is not null then
    select id into v_task_id from public.tasks
      where requested_by_id = v_actor_id and client_request_id = p_client_request_id;
    if v_task_id is not null then return v_task_id; end if;
  end if;
  begin
    insert into public.tasks (id, household_id, title, expected_minutes, due_at, priority, status, requested_by_id, event_id, document_id, subtasks, client_request_id)
    values (coalesce(p_task_id, gen_random_uuid()), p_household_id, p_title, p_expected_minutes, p_due_at, p_priority, 'open', v_actor_id, p_event_id, p_document_id, coalesce(p_subtasks, '[]'::jsonb), p_client_request_id)
    returning id into v_task_id;
  exception
    when unique_violation then
      -- 并发幂等（同 request id 另一请求已插入）→ 回查返回；否则为 p_task_id 占用（含跨家庭）→ 业务错误。
      if p_client_request_id is not null then
        select id into v_task_id from public.tasks
          where requested_by_id = v_actor_id and client_request_id = p_client_request_id;
        if v_task_id is not null then return v_task_id; end if;
      end if;
      raise exception 'TASK_ID_TAKEN';
  end;
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

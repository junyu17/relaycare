-- TaskKin Care MVP - atomic P0 task workflow RPCs.
-- SECURITY INVOKER deliberately preserves the caller's existing RLS boundary.

create or replace function public.create_task_with_activity(
  p_household_id uuid, p_title text, p_expected_minutes integer, p_due_at timestamptz,
  p_priority text, p_subtasks jsonb default '[]'::jsonb, p_event_id uuid default null,
  p_document_id uuid default null
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_task_id uuid;
  v_actor_id uuid := public.current_member_id();
  v_actor_name text;
begin
  if v_actor_id is null or not public.can_coordinate_work() then raise exception 'Task creation is not permitted'; end if;
  select name into v_actor_name from public.members where id = v_actor_id;
  insert into public.tasks (household_id, title, expected_minutes, due_at, priority, status, requested_by_id, event_id, document_id, subtasks)
  values (p_household_id, p_title, p_expected_minutes, p_due_at, p_priority, 'open', v_actor_id, p_event_id, p_document_id, coalesce(p_subtasks, '[]'::jsonb))
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

create or replace function public.transition_task_with_activity(
  p_task_id uuid, p_action text, p_handoff_to_id uuid default null,
  p_rejection_reason text default null, p_proof text default null
) returns void language plpgsql security invoker set search_path = public as $$
declare
  v_task public.tasks%rowtype;
  v_actor_id uuid := public.current_member_id();
  v_actor_name text;
  v_target public.members%rowtype;
  v_audience text;
  v_title_key text;
  v_body_key text;
  v_values jsonb;
  v_detail text;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found or v_actor_id is null or not public.can_coordinate_work() then raise exception 'Task action is not permitted'; end if;
  select name into v_actor_name from public.members where id = v_actor_id;

  if p_action = 'claim' then
    if v_task.status not in ('open', 'rejected', 'handoff_requested') or (v_task.status = 'handoff_requested' and v_task.handoff_to_id <> v_actor_id) then raise exception 'Task cannot be claimed in its current state'; end if;
    update public.tasks set status = 'claimed', owner_id = v_actor_id, handoff_to_id = null, rejection_reason = null where id = p_task_id;
    v_audience := 'coordinator'; v_title_key := 'notification.title.taskClaimed'; v_body_key := 'notification.body.taskClaimed';
    v_values := jsonb_build_object('task', v_task.title, 'name', v_actor_name); v_detail := format('%s claimed "%s".', v_actor_name, v_task.title);
  elsif p_action = 'reject' then
    if not public.is_coordinator() and v_task.owner_id <> v_actor_id then raise exception 'Only the task owner can reject this task'; end if;
    update public.tasks set status = 'rejected', rejection_reason = coalesce(p_rejection_reason, ''), owner_id = null where id = p_task_id;
    v_detail := format('%s declined "%s": %s', v_actor_name, v_task.title, coalesce(p_rejection_reason, ''));
  elsif p_action = 'handoff' then
    if p_handoff_to_id is null then raise exception 'A handoff target is required'; end if;
    if not public.is_coordinator() and v_task.owner_id <> v_actor_id then raise exception 'Only the task owner can request a handoff'; end if;
    select * into v_target from public.members where id = p_handoff_to_id and household_id = v_task.household_id and invite_status = 'active';
    if not found or v_target.role not in ('coordinator', 'caregiver') then raise exception 'The handoff target must be an active worker'; end if;
    update public.tasks set status = 'handoff_requested', handoff_to_id = p_handoff_to_id where id = p_task_id;
    v_audience := v_target.role; v_title_key := 'notification.title.handoffRequested'; v_body_key := 'notification.body.handoffRequested';
    v_values := jsonb_build_object('task', v_task.title, 'name', v_actor_name); v_detail := format('%s requested handoff of "%s" to %s.', v_actor_name, v_task.title, v_target.name);
  elsif p_action = 'complete' then
    if not public.is_coordinator() and v_task.owner_id <> v_actor_id then raise exception 'Only the task owner can complete this task'; end if;
    update public.tasks set status = 'completed', proof = coalesce(p_proof, '') where id = p_task_id;
    v_audience := 'coordinator'; v_title_key := 'notification.title.taskCompleted'; v_body_key := 'notification.body.taskCompleted';
    v_values := jsonb_build_object('task', v_task.title, 'name', v_actor_name); v_detail := format('%s completed "%s".', v_actor_name, v_task.title);
  else
    raise exception 'Unsupported task action';
  end if;

  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_task.household_id, v_actor_id, case p_action when 'claim' then 'task.claimed' when 'reject' then 'task.rejected' when 'handoff' then 'task.handoff_requested' when 'complete' then 'task.completed' end, 'task', p_task_id::text, v_detail);
  if v_audience is not null then
    insert into public.role_notifications (household_id, audience, severity, title_key, body_key, values, entity_type, entity_id)
    values (v_task.household_id, v_audience, 'info', v_title_key, v_body_key, v_values, 'task', p_task_id::text);
  end if;
end;
$$;

revoke all on function public.create_task_with_activity(uuid, text, integer, timestamptz, text, jsonb, uuid, uuid) from public;
revoke all on function public.transition_task_with_activity(uuid, text, uuid, text, text) from public;
grant execute on function public.create_task_with_activity(uuid, text, integer, timestamptz, text, jsonb, uuid, uuid) to authenticated;
grant execute on function public.transition_task_with_activity(uuid, text, uuid, text, text) to authenticated;

-- 0042: R2 修复（IOS_SUBMISSION_REVIEW_R2）
-- B1: generate_weekly_reports 改用 audit_events 统计完成数（tasks 无 completed_at 列，
--     plpgsql 延迟编译导致首次执行即报错，pg_cron 每周一静默失败）。
-- B5: update_notification_preference 加回 p_member_id（本人或同家庭 coordinator 可写目标成员行）。
create or replace function public.generate_weekly_reports()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_week_start date := date_trunc('week', now() - interval '1 week')::date;
  v_week_end timestamptz := (v_week_start + interval '7 days')::timestamptz;
  v_tasks_created int;
  v_tasks_completed int;
  v_events int;
  v_metrics jsonb;
begin
  for r in
    select h.id
    from public.households h
    where public.effective_plan(h.id) in ('monthly', 'yearly')
  loop
    select count(*) into v_tasks_created
      from public.tasks t where t.household_id = r.id
        and t.created_at >= v_week_start and t.created_at < v_week_end;
    -- B1: tasks 无 completed_at，完成数从审计事件统计（action='task.completed'）
    select count(*) into v_tasks_completed
      from public.audit_events a where a.household_id = r.id
        and a.action = 'task.completed'
        and a.created_at >= v_week_start and a.created_at < v_week_end;
    select count(*) into v_events
      from public.care_events e where e.household_id = r.id
        and e.created_at >= v_week_start and e.created_at < v_week_end;
    v_metrics := jsonb_build_object(
      'tasksCreated', v_tasks_created,
      'tasksCompleted', v_tasks_completed,
      'events', v_events,
      'weekStart', to_char(v_week_start, 'YYYY-MM-DD')
    );
    insert into public.weekly_reports (household_id, week_start, metrics)
    values (r.id, v_week_start, v_metrics)
    on conflict (household_id, week_start) do update set metrics = excluded.metrics, created_at = now();
  end loop;
end;
$$;
revoke all on function public.generate_weekly_reports() from public;
revoke all on function public.generate_weekly_reports() from anon;
revoke all on function public.generate_weekly_reports() from authenticated;
grant execute on function public.generate_weekly_reports() to service_role;

-- B5: 偏好 RPC 加 p_member_id（本人或同家庭 coordinator）
drop function if exists public.update_notification_preference(text, text, boolean);
create or replace function public.update_notification_preference(
  p_member_id uuid,
  p_quiet_hours_start text,
  p_quiet_hours_end text,
  p_task_digest boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.current_member_id();
  v_target_household uuid;
begin
  if v_actor is null then
    raise exception 'Not a household member';
  end if;
  if p_quiet_hours_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Invalid quiet hours start';
  end if;
  if p_quiet_hours_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Invalid quiet hours end';
  end if;

  -- 目标成员的家庭
  select household_id into v_target_household from public.members where id = p_member_id and invite_status = 'active';
  if v_target_household is null then
    raise exception 'Target member not found';
  end if;
  -- 本人或同家庭 coordinator 才可写目标行
  if v_actor <> p_member_id and not (
    select exists (select 1 from public.members m
      where m.id = v_actor and m.household_id = v_target_household and m.role = 'coordinator' and m.invite_status = 'active')
  ) then
    raise exception 'Only the member or a coordinator can update notification preferences';
  end if;
  -- R5 套餐门禁（服务端权威）
  if public.effective_plan(v_target_household) not in ('monthly', 'yearly') then
    raise exception 'Family Plus required';
  end if;

  update public.notification_preferences
    set quiet_hours_start = p_quiet_hours_start,
        quiet_hours_end = p_quiet_hours_end,
        task_digest = p_task_digest
    where member_id = p_member_id;
end;
$$;
revoke all on function public.update_notification_preference(uuid, text, text, boolean) from public;
revoke all on function public.update_notification_preference(uuid, text, text, boolean) from anon;
grant execute on function public.update_notification_preference(uuid, text, text, boolean) to authenticated;

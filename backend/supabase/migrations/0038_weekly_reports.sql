-- 0038: 自动周报 + 历史（R6，IOS_SUBMISSION_DEV_SPEC）
--
-- weekly_reports：每家庭每周一条聚合指标（Plus 专属历史）。
-- 套餐门禁在 SQL 内（list_weekly_reports 对 Free 只返回 1 条，AC6-2），不信客户端。
-- generate_weekly_reports 仅 service_role 可执行，由 pg_cron 每周一 08:00 UTC 调度（AC6-4）。
create table if not exists public.weekly_reports (
  household_id uuid not null references public.households(id) on delete cascade,
  week_start date not null,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (household_id, week_start)
);

-- 手动记录（coordinator 触发当前周快照，供"立即生成"入口；upsert）
create or replace function public.record_weekly_report(
  p_household_id uuid,
  p_metrics jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mid uuid;
begin
  v_mid := public.current_member_id();
  if v_mid is null or not exists (
    select 1 from public.members m
    where m.id = v_mid and m.household_id = p_household_id
      and m.role = 'coordinator' and m.invite_status = 'active'
  ) then
    raise exception 'Only a coordinator can record a weekly report';
  end if;
  insert into public.weekly_reports (household_id, week_start, metrics)
  values (p_household_id, date_trunc('week', now())::date, coalesce(p_metrics, '{}'::jsonb))
  on conflict (household_id, week_start) do update
    set metrics = excluded.metrics, created_at = now();
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (p_household_id, v_mid, 'report.generated', 'report', p_household_id::text,
          format('%s recorded a weekly report.', coalesce((select name from public.members where id = v_mid), 'Coordinator')));
end;
$$;
revoke all on function public.record_weekly_report(uuid, jsonb) from public;
revoke all on function public.record_weekly_report(uuid, jsonb) from anon;
grant execute on function public.record_weekly_report(uuid, jsonb) to authenticated;

-- 历史列表：Free 只返回最近 1 条（服务端拦截，AC6-2）；Plus 最多 p_limit（上限 52）
create or replace function public.list_weekly_reports(
  p_household_id uuid,
  p_limit int default 12
) returns table (week_start date, metrics jsonb, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mid uuid;
  v_plan text;
  v_limit int;
begin
  v_mid := public.current_member_id();
  if v_mid is null or not exists (
    select 1 from public.members m
    where m.id = v_mid and m.household_id = p_household_id and m.invite_status = 'active'
  ) then
    raise exception 'Not a household member';
  end if;
  v_plan := public.effective_plan(p_household_id);
  if v_plan not in ('monthly', 'yearly') then
    v_limit := 1; -- Free：仅最近 1 条
  else
    v_limit := least(greatest(coalesce(p_limit, 12), 1), 52);
  end if;
  return query
    select r.week_start, r.metrics, r.created_at
    from public.weekly_reports r
    where r.household_id = p_household_id
    order by r.week_start desc
    limit v_limit;
end;
$$;
revoke all on function public.list_weekly_reports(uuid, int) from public;
revoke all on function public.list_weekly_reports(uuid, int) from anon;
grant execute on function public.list_weekly_reports(uuid, int) to authenticated;

-- 自动生成（service_role 专用，pg_cron 调度）：遍历 Plus 家庭聚合上周指标
create or replace function public.generate_weekly_reports()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_week_start date := date_trunc('week', now() - interval '1 week')::date;
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
      from public.tasks t where t.household_id = r.id and t.created_at >= v_week_start;
    select count(*) into v_tasks_completed
      from public.tasks t where t.household_id = r.id
        and t.completed_at is not null and t.completed_at >= v_week_start;
    select count(*) into v_events
      from public.care_events e where e.household_id = r.id and e.created_at >= v_week_start;
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

-- pg_cron 调度（每周一 08:00 UTC）
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('generate-weekly-reports', '0 8 * * 1', 'select public.generate_weekly_reports()');
  end if;
exception when undefined_table or undefined_function then
  null; -- pg_cron 未启用时跳过（由 Supabase Dashboard 手动启用）
end;
$$;

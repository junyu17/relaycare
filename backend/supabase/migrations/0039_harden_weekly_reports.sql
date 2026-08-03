-- 0039: 收紧 weekly_reports 表级权限 + 聚合周界修复（R6 补漏，IOS_SUBMISSION_DEV_SPEC）
--
-- 0038 只收敛了 RPC 权限，未对表做 RLS/revoke：Supabase 默认对新表 GRANT ALL TO
-- anon, authenticated，PostgREST 可绕过 list_weekly_reports 的套餐/成员门禁直读写。
-- 修复（BLOCKING）：客户端一律禁止直写，且不设 SELECT 策略（默认 deny，只走 RPC）。
revoke all on table public.weekly_reports from anon, authenticated, service_role;
alter table public.weekly_reports enable row level security;
-- service_role 经 RPC（definer）访问，不依赖表级授权；如需管理直查在 Dashboard 临时授权。

-- 重写 generate_weekly_reports：聚合加上界 < week_start + 7 天（cron 延迟运行时
-- 不把本周数据计入上周报告并覆盖已生成行）。
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
    select count(*) into v_tasks_completed
      from public.tasks t where t.household_id = r.id
        and t.completed_at is not null and t.completed_at >= v_week_start and t.completed_at < v_week_end;
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

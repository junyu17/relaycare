-- 0040: 审计保留期生效（R7，IOS_SUBMISSION_DEV_SPEC）
--
-- 付费墙宣称 Free 保留 30 天 / Plus 保留 3 年（PLAN_LIMITS.auditRetentionDays
-- free=30, plus=1095）。按家庭套餐删除过期 audit_events，pg_cron 每天调度；
-- 仅 service_role 可执行（0030 已收回 authenticated）。
create or replace function public.cleanup_audit_by_retention()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_retention_days int;
begin
  for r in
    select h.id, public.effective_plan(h.id) as plan
    from public.households h
  loop
    v_retention_days := case when r.plan in ('monthly', 'yearly') then 1095 else 30 end;
    delete from public.audit_events
      where household_id = r.id
        and created_at < now() - make_interval(days => v_retention_days);
  end loop;
end;
$$;
revoke all on function public.cleanup_audit_by_retention() from public;
revoke all on function public.cleanup_audit_by_retention() from anon;
revoke all on function public.cleanup_audit_by_retention() from authenticated;
grant execute on function public.cleanup_audit_by_retention() to service_role;

-- pg_cron 每天 03:00 UTC 调度
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('cleanup-audit-by-retention', '0 3 * * *', 'select public.cleanup_audit_by_retention()');
  end if;
exception when undefined_table or undefined_function then
  null; -- pg_cron 未启用时跳过
end;
$$;

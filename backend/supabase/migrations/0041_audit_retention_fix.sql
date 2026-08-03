-- 0041: 0040 的 should-fix 补发（R7，IOS_SUBMISSION_DEV_SPEC）
-- 0040 已应用生产，其 cron 幂等/作业名/drop 死代码修改需新迁移补发。
-- 1) cron 作业名对齐 AC7-1（taskkin-audit-cleanup，幂等）
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('cleanup-audit-by-retention') where exists (select 1 from cron.job where jobname = 'cleanup-audit-by-retention');
    perform cron.unschedule('taskkin-audit-cleanup') where exists (select 1 from cron.job where jobname = 'taskkin-audit-cleanup');
    perform cron.schedule('taskkin-audit-cleanup', '0 3 * * *', 'select public.cleanup_audit_by_retention()');
  end if;
exception when undefined_table or undefined_function then
  null;
end;
$$;
-- 2) 删除死代码 cleanup_old_audit（0008，已被 cleanup_audit_by_retention 取代；0030 已收回 authenticated）
drop function if exists public.cleanup_old_audit();

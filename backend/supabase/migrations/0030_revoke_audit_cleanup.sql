-- 0030: 收回 cleanup_old_audit 的 authenticated 执行权（I4）
--
-- 背景：0008_paywall.sql:280 将该 security definer 函数 grant 给 authenticated——
-- 任何登录用户可触发全平台 30 天前审计删除（跨家庭数据破坏/审计擦除，review 阻断项）。
-- 修复：仅 service_role 可调（由 Edge Function / pg_cron 按需调度）。
revoke all on function public.cleanup_old_audit() from public;
revoke all on function public.cleanup_old_audit() from anon;
revoke all on function public.cleanup_old_audit() from authenticated;
grant execute on function public.cleanup_old_audit() to service_role;

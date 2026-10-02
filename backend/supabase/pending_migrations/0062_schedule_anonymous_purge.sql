-- 0062: 每天跑一次匿名账号清理（0061 的定时部分，单独成文件）
--
-- ⚠ 上线时机：0061 上线、purge-abandoned-anonymous 部署、Vault 里存好 SUPABASE_URL 和 CRON_SECRET，
--   并且已经用下面的只读查询核对过候选账号（数量和类别，确认没有带其他成员的家庭）之后，
--   才把本文件移进 backend/supabase/migrations/ 并 db push：
--     select kind, count(*) from public.anonymous_retention_candidates(500) group by kind;
--
-- 与 0038 / 0040 / 0041 一样只在 pg_cron 已启用时安排任务；没启用时给出 NOTICE，不报错。
-- 每天 04:30 UTC（避开 03:00 的审计清理）。

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('taskkin-purge-abandoned-anonymous')
      where exists (select 1 from cron.job where jobname = 'taskkin-purge-abandoned-anonymous');
    perform cron.schedule(
      'taskkin-purge-abandoned-anonymous',
      '30 4 * * *',
      'select public.invoke_purge_abandoned_anonymous()'
    );
  else
    raise notice 'pg_cron is not enabled; taskkin-purge-abandoned-anonymous was not scheduled';
  end if;
exception when undefined_table or undefined_function then
  raise notice 'pg_cron is not available; taskkin-purge-abandoned-anonymous was not scheduled';
end;
$$;

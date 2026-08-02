-- 0033: 修复 get_household_code 列歧义（P0-1，FINAL_LAUNCH_AUDIT 2026-08-02）
--
-- returns table (code text, ...) 使 code 成为 PL/pgSQL 输出变量；原查询
-- `select code::text from public.household_codes` 未加表别名，PostgreSQL 无法
-- 区分输出变量与表列 → SQLSTATE 42702 column reference "code" is ambiguous，
-- 协调人读取已有家庭码在生产返回 HTTP 400（前端 catch 静默吞掉）。
create or replace function public.get_household_code()
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare v_hid uuid := public.current_household_id();
begin
  if v_hid is null or not public.is_coordinator() then
    raise exception 'Only a coordinator can view the join code';
  end if;
  return query
    select hc.code::text, hc.expires_at
    from public.household_codes as hc
    where hc.household_id = v_hid and hc.status = 'active' and hc.expires_at > now()
    order by hc.created_at desc
    limit 1;
end;
$$;
revoke all on function public.get_household_code() from public;
grant execute on function public.get_household_code() to authenticated;

-- 0061: 被放弃的匿名账号自动清理（决策 5A）
--
-- ⚠ 上线时机：1.10 发布后一周内。移进 backend/supabase/migrations/ 后 db push，并 deploy
--   purge-abandoned-anonymous。定时任务在 0062，等先用下面的只读查询核对过候选账号再上：
--     select kind, count(*) from public.anonymous_retention_candidates(500) group by kind;
--   （确认里面没有带其他成员的家庭，再把 0062 移进 migrations 目录 db push。）
--
-- 匿名会话失效后（删 app 且 Keychain 没留住、换机、长期不用），健康资料和文档会永久留在服务器上，
-- 本人既看不到也删不掉。只清理「数据只属于自己」的未绑定匿名账号，所以永远不会碰到家人还在用的家庭：
--   empty：没有成员关系、名下没有订阅，最后活动距今超过 30 天；
--   solo ：名下没有订阅（任何状态），所在的每个家庭除自己外没有 active / pending 成员，
--          最后活动距今超过 180 天。
-- 「未绑定」= auth.users.is_anonymous 且 0058 的 is_bound_user 为假（即使 GoTrue 没把
-- linkIdentity 之后的 is_anonymous 改掉，挂了 Apple identity 的账号也不会被清理）。
-- 最后活动 = greatest(users.created_at, users.last_sign_in_at, sessions.refreshed_at / updated_at /
-- created_at, refresh_tokens.updated_at / created_at)。列名和类型按 supabase/auth 的 migrations 核对：
-- sessions.refreshed_at 是 timestamp without time zone（GoTrue 写 UTC），refresh_tokens.user_id 是 varchar。
--
-- 删除顺序（Edge Function purge-abandoned-anonymous，与 delete-account 共用 _shared/account-cleanup.ts）：
--   purge_anonymous_account_data（锁内复查 + delete_account_data，Storage 目标进 0053 的清理队列）
--   → Storage 清理 → admin.deleteUser。Storage 文件不能用 SQL 直接删，所以这一步必须在 Edge Function。
--
-- 单用户模式（处理邮件删号申请，Billy 每次单独同意后才调用）：p_user_id 非空时只看这一个账号，
-- 条件不变，只把不活跃门槛改成 14 天。

-- ============ anonymous_last_activity ============
create or replace function public.anonymous_last_activity(p_uid uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
           u.created_at,
           u.last_sign_in_at,
           (select max(greatest(s.refreshed_at at time zone 'UTC', s.updated_at, s.created_at))
              from auth.sessions s
              where s.user_id = u.id),
           (select max(greatest(rt.updated_at, rt.created_at))
              from auth.refresh_tokens rt
              where rt.user_id = u.id::text)
         )
    from auth.users u
    where u.id = p_uid;
$$;
revoke all on function public.anonymous_last_activity(uuid) from public, anon, authenticated;
grant execute on function public.anonymous_last_activity(uuid) to service_role;

-- ============ anonymous_retention_kind：'empty' | 'solo' | NULL（不清理）============
create or replace function public.anonymous_retention_kind(
  p_uid uuid,
  p_empty_after interval default interval '30 days',
  p_solo_after interval default interval '180 days'
) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when u.is_anonymous is not true then null
           when public.is_bound_user(u.id) then null
           when not public.account_has_data(u.id) then
             case when public.anonymous_last_activity(u.id) < now() - p_empty_after then 'empty' end
           when exists (
             select 1 from public.subscriptions s
             where s.owner_user_id = u.id or s.owner_app_account_token = u.id
           ) then null
           when exists (
             select 1
               from public.members mine
               join public.members other
                 on other.household_id = mine.household_id
                and other.id <> mine.id
               where mine.user_id = u.id
                 and other.invite_status in ('active', 'pending')
           ) then null
           when public.anonymous_last_activity(u.id) < now() - p_solo_after then 'solo'
         end
    from auth.users u
    where u.id = p_uid;
$$;
revoke all on function public.anonymous_retention_kind(uuid, interval, interval) from public, anon, authenticated;
grant execute on function public.anonymous_retention_kind(uuid, interval, interval) to service_role;

-- ============ anonymous_retention_candidates（只读）============
create or replace function public.anonymous_retention_candidates(
  p_limit int default 50,
  p_user_id uuid default null
) returns table (user_id uuid, kind text, last_activity timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, k.kind, public.anonymous_last_activity(u.id)
    from auth.users u
    cross join lateral (
      select public.anonymous_retention_kind(
               u.id,
               case when p_user_id is null then interval '30 days' else interval '14 days' end,
               case when p_user_id is null then interval '180 days' else interval '14 days' end
             ) as kind
    ) k
    where u.is_anonymous
      and k.kind is not null
      and (p_user_id is null or u.id = p_user_id)
    order by u.created_at asc
    limit greatest(least(coalesce(p_limit, 50), 500), 0);
$$;
revoke all on function public.anonymous_retention_candidates(int, uuid) from public, anon, authenticated;
grant execute on function public.anonymous_retention_candidates(int, uuid) to service_role;

-- ============ purge_anonymous_account_data：锁内复查后删除数据 ============
-- 返回删掉的类别（'empty' / 'solo'），不再满足条件返回 NULL、什么都不删。
-- 锁住 auth.users 行（并发的 linkIdentity 插入 identity 时要取 KEY SHARE 锁，会等我们提交），
-- 再锁住他所在每一户的 household_join advisory lock（join_by_code / v2 / approve 都先取这把锁），
-- 复查期间没人能绑定或加入，复查通过才调用 0053 的 delete_account_data。
create or replace function public.purge_anonymous_account_data(
  p_uid uuid,
  p_single_user boolean default false
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_kind text;
begin
  if p_uid is null then
    return null;
  end if;

  begin
    perform 1 from auth.users u where u.id = p_uid for update;
  exception when insufficient_privilege then
    perform 1 from auth.users u where u.id = p_uid;
  end;
  if not found then
    return null;
  end if;

  for v_household_id in
    select distinct m.household_id from public.members m where m.user_id = p_uid order by m.household_id
  loop
    perform pg_advisory_xact_lock(hashtext('household_join:' || v_household_id::text));
  end loop;

  v_kind := public.anonymous_retention_kind(
    p_uid,
    case when p_single_user then interval '14 days' else interval '30 days' end,
    case when p_single_user then interval '14 days' else interval '180 days' end
  );
  if v_kind is null then
    return null;
  end if;

  perform public.delete_account_data(p_uid);
  return v_kind;
end;
$$;
revoke all on function public.purge_anonymous_account_data(uuid, boolean) from public, anon, authenticated;
grant execute on function public.purge_anonymous_account_data(uuid, boolean) to service_role;

-- ============ invoke_purge_abandoned_anonymous：给 pg_cron 用（0062 安排每天一次）============
-- 用 pg_net 调 Edge Function，请求头 x-cron-secret 取 Vault 里的 CRON_SECRET；
-- 项目地址取 Vault 里的 SUPABASE_URL（不写进公开仓库）。两个 secret 缺一个就报错，不发请求。
create or replace function public.invoke_purge_abandoned_anonymous()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if to_regclass('vault.decrypted_secrets') is null or to_regnamespace('net') is null then
    raise exception 'pg_net and Supabase Vault are required for the anonymous purge job';
  end if;
  select ds.decrypted_secret into v_url from vault.decrypted_secrets ds where ds.name = 'SUPABASE_URL' limit 1;
  select ds.decrypted_secret into v_secret from vault.decrypted_secrets ds where ds.name = 'CRON_SECRET' limit 1;
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    raise exception 'Vault secrets SUPABASE_URL and CRON_SECRET are required for the anonymous purge job';
  end if;
  return net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/purge-abandoned-anonymous',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    timeout_milliseconds := 120000
  );
end;
$$;
revoke all on function public.invoke_purge_abandoned_anonymous() from public, anon, authenticated, service_role;

-- 0057: 防猜码计数修复（现在就上；不依赖任何 Apple 配置，兼容 app 1.9）
--
-- 问题：0031 的 join_by_code 在码不存在时 RAISE 'Invalid or expired code'。PostgREST
-- 遇到异常回滚整个事务，join_attempts 的 +1 随之回滚，「每 uid 15 分钟 5 次」形同虚设：
-- 一个匿名账号就能无限猜码（按 20 次/秒约 4.6 小时猜中一个有效码），猜中即成为 caregiver。
--
-- 修复（签名与英文报错文案都不变，1.9 可以直接显示）：
--   1. 顺序：格式校验 → 每 uid 15 分钟 5 次 → 全站熔断 → uid 计数 +1 → 查码。
--      前两项拒绝时还没有任何写入，RAISE 回滚不丢计数。
--   2. 码不存在：先 join_record_failure() 记全站失败，再 RETURN NULL（不 RAISE），
--      uid 计数和全站计数都随事务提交。代价：1.9 输错数字时没有提示
--      （AuthContext.joinByCode 遇到 null 时 refreshHouseholds 不报错）。
--   3. 码已过期：保留原英文报错（hint join_code_expired）。过期码不可能给出访问权，
--      所以这一次不计数也没有风险；1.9 最常见的「码已过期」提示保持不变。
--      （0014 起这里有一句 update ... set status = 'locked'，但紧接着的 RAISE 会把它回滚，
--       一直是空操作，这里去掉。）
--   4. 全站熔断：join_failure_windows 按 5 分钟分桶记失败次数，最近 3 个桶（15 分钟）
--      合计 ≥30 次就把 join_breaker 熔断 30 分钟。熔断期间 join_by_code 报原来的限流错误。
--      过渡期（1.10 之前）熔断 = 全站暂停凭码加入，有拒绝服务风险，按现在的规模可以接受；
--      0059 的 join_by_code_v2 把熔断降级为「需要协调人同意」。不存 IP，也不存 uid。
--   5. generate_household_code 改用 CSPRNG：从 gen_random_uuid()（v4，前 32 位全随机）派生
--      6 位码，不再用 random()。
--   6. 所有 RAISE 保留原英文 message，另加稳定的 hint 码（PostgREST 原样返回 hint），
--      1.10 按 hint 映射 6 种语言：
--        not_authenticated / join_code_format / join_rate_limited / join_code_expired /
--        join_member_limit / join_already_member / coordinator_required
--   7. 顺带关掉 0011 留下的订阅伪造口子（与防猜码无关，但同样是线上安全问题，所以跟 0057 一起现在就上）：
--      upsert_subscription 是 SECURITY DEFINER，会调用 set_household_plus。0011 只 revoke 了 PUBLIC，
--      而 Supabase 的默认权限会把 public 下新建的函数显式授予 anon / authenticated，之后也没有迁移
--      收回（0027 只修了 register_apple_subscription / sync_subscription_by_transaction /
--      set_household_plus）。结果：拿着 app 里公开的 anon key 就能 POST /rest/v1/rpc/upsert_subscription，
--      给任意家庭开 Plus、把别人的家庭降为 Free，或把已有订阅行改挂到别的家庭。
--      src/ 和 functions/ 都不调用它；这里只收回 API 角色的执行权，service_role 保持不变。
--      0058 开头再执行一次同样的 revoke（幂等），以防 0057 在加入这一节之前就已经推到线上。

-- ============ 全站失败计数：5 分钟一个桶（不存 IP、不存 uid）============
create table if not exists public.join_failure_windows (
  bucket_start timestamptz primary key,
  failures int not null default 0 check (failures >= 0)
);
alter table public.join_failure_windows enable row level security;
revoke all on table public.join_failure_windows from anon, authenticated;

-- ============ 全站熔断状态（单行）============
create table if not exists public.join_breaker (
  id smallint primary key check (id = 1),
  tripped_until timestamptz,
  last_tripped_at timestamptz,
  trips int not null default 0
);
alter table public.join_breaker enable row level security;
revoke all on table public.join_breaker from anon, authenticated;
insert into public.join_breaker (id) values (1) on conflict (id) do nothing;

-- ============ join_record_failure：记一次失败，必要时熔断（内部函数）============
create or replace function public.join_record_failure()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket timestamptz := date_bin('5 minutes', now(), timestamptz '2000-01-01 00:00:00+00');
  v_recent int;
begin
  insert into public.join_failure_windows as w (bucket_start, failures)
  values (v_bucket, 1)
  on conflict (bucket_start) do update set failures = w.failures + 1;

  -- 当前桶 + 前两个桶 = 最近 15 分钟。
  select coalesce(sum(failures), 0) into v_recent
    from public.join_failure_windows
    where bucket_start >= v_bucket - interval '10 minutes';

  if v_recent >= 30 then
    -- 已在熔断中则只延长，不重复计 trips（v2 在熔断期间仍会记失败）。
    update public.join_breaker
      set trips = trips + case when tripped_until is null or tripped_until <= now() then 1 else 0 end,
          last_tripped_at = case when tripped_until is null or tripped_until <= now() then now() else last_tripped_at end,
          tripped_until = greatest(coalesce(tripped_until, now()), now() + interval '30 minutes')
      where id = 1;
  end if;

  -- 顺带清掉 1 天以前的桶。
  delete from public.join_failure_windows where bucket_start < now() - interval '1 day';
end;
$$;
revoke all on function public.join_record_failure() from public, anon, authenticated;

-- ============ join_breaker_tripped：当前是否处于熔断（内部函数）============
create or replace function public.join_breaker_tripped()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select b.tripped_until > now() from public.join_breaker b where b.id = 1), false);
$$;
revoke all on function public.join_breaker_tripped() from public, anon, authenticated;

-- ============ join_by_code：签名不变，失败计数可提交 ============
create or replace function public.join_by_code(
  p_code text,
  p_display_name text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code public.household_codes%rowtype;
  v_member_id uuid;
  v_count int;
  v_limit int;
  v_att public.join_attempts%rowtype;
  v_window_expired boolean;
  v_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using hint = 'not_authenticated';
  end if;
  if p_code is null or p_code !~ '^[0-9]{6}$' then
    raise exception 'Code must be 6 digits' using hint = 'join_code_format';
  end if;

  -- 1) 每 uid 15 分钟 5 次。新 uid 先补一行（并发首次调用不会撞主键）。
  insert into public.join_attempts (user_id, attempts, window_start)
  values (v_uid, 0, now())
  on conflict (user_id) do nothing;
  select * into v_att from public.join_attempts where user_id = v_uid for update;
  v_window_expired := now() - v_att.window_start > interval '15 minutes';
  if not v_window_expired and v_att.attempts >= 5 then
    raise exception 'Too many join attempts. Please wait a few minutes and try again.'
      using hint = 'join_rate_limited';
  end if;

  -- 2) 全站熔断（1.9 期间 = 暂停凭码加入；0059 的 v2 改为需要协调人同意）。
  if public.join_breaker_tripped() then
    raise exception 'Too many join attempts. Please wait a few minutes and try again.'
      using hint = 'join_rate_limited';
  end if;

  -- 3) uid 计数 +1（窗口已过期则重开窗口）。
  if v_window_expired then
    update public.join_attempts set attempts = 1, window_start = now() where user_id = v_uid;
  else
    update public.join_attempts set attempts = attempts + 1 where user_id = v_uid;
  end if;

  -- 4) 查码。
  select * into v_code from public.household_codes where code = p_code and status = 'active' for update;
  if not found then
    -- 不 RAISE：uid 计数与全站失败计数都要提交，否则限流会被回滚抵消。
    perform public.join_record_failure();
    return null;
  end if;
  if v_code.expires_at <= now() then
    raise exception 'Code has expired. Ask the coordinator for a new one.'
      using hint = 'join_code_expired';
  end if;

  -- I15: 家庭级 advisory lock（并发 join 串行化，防成员数检查与插入竞态超上限）
  perform pg_advisory_xact_lock(hashtext('household_join:' || v_code.household_id::text));

  select count(*) into v_count
    from public.members
    where household_id = v_code.household_id
      and invite_status <> 'removed';
  v_limit := case when public.effective_plan(v_code.household_id) in ('monthly','yearly') then 12 else 3 end;
  if v_count >= v_limit then
    raise exception 'Household member limit reached (%)', v_limit using hint = 'join_member_limit';
  end if;

  if exists (
    select 1
    from public.members
    where household_id = v_code.household_id
      and user_id = v_uid
      and invite_status = 'active'
  ) then
    raise exception 'You are already a member of this household' using hint = 'join_already_member';
  end if;

  v_name := coalesce(nullif(trim(p_display_name), ''), 'Family member');
  insert into public.members (household_id, user_id, name, relation, role, timezone, invite_status)
  values (v_code.household_id, v_uid, v_name, '', 'caregiver', 'America/Los_Angeles', 'active')
  returning id into v_member_id;
  insert into public.notification_preferences (household_id, member_id) values (v_code.household_id, v_member_id);

  insert into public.user_household_context (user_id, household_id, updated_at)
  values (v_uid, v_code.household_id, now())
  on conflict (user_id) do update set household_id = excluded.household_id, updated_at = now();

  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_code.household_id, v_member_id, 'member.joined', 'member', v_member_id::text, v_name || ' joined the household by code.');

  insert into public.role_notifications (household_id, audience, severity, title_key, body_key, values, entity_type, entity_id)
  values (v_code.household_id, 'coordinator', 'info', 'notification.title.memberJoined', 'notification.body.memberJoined',
          jsonb_build_object('name', v_name), 'member', v_member_id::text);

  -- 成功：uid 计数清零。
  update public.join_attempts set attempts = 0 where user_id = v_uid;
  return v_code.household_id;
end;
$$;
revoke all on function public.join_by_code(text, text) from public;
revoke all on function public.join_by_code(text, text) from anon;
grant execute on function public.join_by_code(text, text) to authenticated;

-- ============ generate_household_code：CSPRNG 出码 ============
create or replace function public.generate_household_code()
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hid uuid := public.current_household_id();
  v_actor uuid := public.current_member_id();
  v_code text;
  v_expires timestamptz := now() + interval '15 minutes';
begin
  if v_actor is null or not public.is_coordinator() then
    raise exception 'Only a coordinator can generate a join code' using hint = 'coordinator_required';
  end if;
  -- 作废该家庭旧码。
  update public.household_codes set status = 'locked' where household_id = v_hid and status = 'active';
  -- 6 位码：gen_random_uuid()（CSPRNG）的前 32 位对 10^6 取模，冲突重试。
  for i in 1..5 loop
    v_code := lpad(
      ((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint) % 1000000)::text,
      6,
      '0'
    );
    begin
      insert into public.household_codes (household_id, code, expires_at, created_by)
      values (v_hid, v_code, v_expires, v_actor);
      return query select v_code, v_expires;
      return;
    exception when unique_violation then
      v_code := null;
    end;
  end loop;
  raise exception 'Could not generate a unique code, please retry' using hint = 'join_code_retry';
end;
$$;
revoke all on function public.generate_household_code() from public;
revoke all on function public.generate_household_code() from anon;
grant execute on function public.generate_household_code() to authenticated;

-- ============ upsert_subscription：收回 API 角色的执行权（见头注释第 7 条）============
revoke all on function public.upsert_subscription(uuid, text, text, timestamptz, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.upsert_subscription(uuid, text, text, timestamptz, text, text, text, uuid)
  to service_role;

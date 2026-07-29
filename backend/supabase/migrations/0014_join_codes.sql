-- 0014: 家庭 6 位加入码 + 匿名成员加入 + 成员管理（退出/移除/解散）
--
-- 目标：仅 coordinator 用邮箱注册；其他成员扫码或输 6 位码加入，后台创建匿名身份。
-- 安全：6 位码 + 15 分钟短期过期 + 每设备尝试次数限流（防枚举）。

-- ============ household_codes：6 位家庭加入码 ============
create table if not exists public.household_codes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  code char(6) not null,
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active','locked','used')),
  created_by uuid not null references public.members(id) on delete cascade,
  created_at timestamptz not null default now()
);
-- 同一时刻一个 6 位码只对应一个活跃家庭（避免歧义）。
create unique index if not exists household_codes_active_code_idx
  on public.household_codes (code) where status = 'active';
create index if not exists household_codes_household_idx on public.household_codes (household_id);
alter table public.household_codes enable row level security;
-- 客户端不可直接读写（仅通过下面的 RPC）。
revoke all on public.household_codes from anon, authenticated;

-- ============ join_attempts：每设备加入尝试限流（防枚举）============
create table if not exists public.join_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  attempts int not null default 0,
  window_start timestamptz not null default now()
);
alter table public.join_attempts enable row level security;
revoke all on public.join_attempts from anon, authenticated;

-- ============ generate_household_code：协调人生成新码（旧码作废）============
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
    raise exception 'Only a coordinator can generate a join code';
  end if;
  -- 作废该家庭旧码。
  update public.household_codes set status = 'locked' where household_id = v_hid and status = 'active';
  -- 生成 6 位码，冲突重试。
  for i in 1..5 loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    begin
      insert into public.household_codes (household_id, code, expires_at, created_by)
      values (v_hid, v_code, v_expires, v_actor);
      return query select v_code, v_expires;
      return;
    exception when unique_violation then
      v_code := null;
    end;
  end loop;
  raise exception 'Could not generate a unique code, please retry';
end;
$$;
revoke all on function public.generate_household_code() from public;
grant execute on function public.generate_household_code() to authenticated;

-- ============ get_household_code：协调人取当前有效码 ============
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
    select code::text, expires_at
    from public.household_codes
    where household_id = v_hid and status = 'active' and expires_at > now()
    order by created_at desc
    limit 1;
end;
$$;
revoke all on function public.get_household_code() from public;
grant execute on function public.get_household_code() to authenticated;

-- ============ join_by_code：匿名/已登录成员凭码加入 ============
-- 调用方需已认证（匿名签到也算）。默认角色 caregiver；coordinator 可后续改角色。
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
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_code !~ '^[0-9]{6}$' then raise exception 'Code must be 6 digits'; end if;

  -- 每设备限流：15 分钟窗口内最多 5 次尝试。
  select * into v_att from public.join_attempts where user_id = v_uid for update;
  if not found then
    insert into public.join_attempts (user_id, attempts, window_start) values (v_uid, 0, now());
    select * into v_att from public.join_attempts where user_id = v_uid;
  end if;
  if now() - v_att.window_start > interval '15 minutes' then
    update public.join_attempts set attempts = 1, window_start = now() where user_id = v_uid;
  else
    if v_att.attempts >= 5 then
      raise exception 'Too many join attempts. Please wait a few minutes and try again.';
    end if;
    update public.join_attempts set attempts = attempts + 1 where user_id = v_uid;
  end if;

  -- 查码。
  select * into v_code from public.household_codes
    where code = p_code and status = 'active'
    for update;
  if not found then
    raise exception 'Invalid or expired code';
  end if;
  if v_code.expires_at <= now() then
    update public.household_codes set status = 'locked' where id = v_code.id;
    raise exception 'Code has expired. Ask the coordinator for a new one.';
  end if;

  -- 成员数上限（Free 3 / Plus 12）。
  select count(*) into v_count from public.members where household_id = v_code.household_id;
  v_limit := case when public.effective_plan(v_code.household_id) in ('monthly','yearly') then 12 else 3 end;
  if v_count >= v_limit then
    raise exception 'Household member limit reached (%)', v_limit;
  end if;

  -- 防重复加入。
  if exists (select 1 from public.members where household_id = v_code.household_id and user_id = v_uid and invite_status = 'active') then
    raise exception 'You are already a member of this household';
  end if;

  -- 创建成员（默认 caregiver）。
  insert into public.members (household_id, user_id, name, relation, role, timezone, invite_status)
  values (v_code.household_id, v_uid, coalesce(nullif(trim(p_display_name), ''), 'Family member'), '', 'caregiver', 'America/Los_Angeles', 'active')
  returning id into v_member_id;
  insert into public.notification_preferences (household_id, member_id) values (v_code.household_id, v_member_id);

  -- 设为活跃家庭。
  insert into public.user_household_context (user_id, household_id, updated_at)
  values (v_uid, v_code.household_id, now())
  on conflict (user_id) do update set household_id = excluded.household_id, updated_at = now();

  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_code.household_id, v_member_id, 'member.joined', 'member', v_member_id::text,
          coalesce(nullif(trim(p_display_name), ''), 'Family member') || ' joined the household by code.');

  -- 加入成功，重置该设备的尝试计数。
  update public.join_attempts set attempts = 0 where user_id = v_uid;

  return v_code.household_id;
end;
$$;
revoke all on function public.join_by_code(text, text) from public;
grant execute on function public.join_by_code(text, text) to authenticated;

-- ============ leave_household：普通成员退出自己（协调人不可，须解散）============
create or replace function public.leave_household(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_member public.members%rowtype;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into v_member from public.members
    where household_id = p_household_id and user_id = v_uid and invite_status = 'active';
  if not found then raise exception 'You are not a member of this household'; end if;
  if v_member.role = 'coordinator' then
    raise exception 'Coordinators cannot leave. Dissolve the household instead.';
  end if;
  delete from public.members where id = v_member.id;
  delete from public.user_household_context where user_id = v_uid and household_id = p_household_id;
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (p_household_id, v_member.id, 'member.left', 'member', v_member.id::text, 'A member left the household.');
end;
$$;
revoke all on function public.leave_household(uuid) from public;
grant execute on function public.leave_household(uuid) to authenticated;

-- ============ remove_member：协调人移除成员（不能移除自己）============
create or replace function public.remove_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hid uuid := public.current_household_id();
  v_actor uuid := public.current_member_id();
  v_target public.members%rowtype;
begin
  if v_actor is null or not public.is_coordinator() then
    raise exception 'Only a coordinator can remove members';
  end if;
  if p_member_id = v_actor then
    raise exception 'Cannot remove yourself. Use leave or dissolve.';
  end if;
  select * into v_target from public.members where id = p_member_id and household_id = v_hid;
  if not found then raise exception 'Member not found in this household'; end if;
  delete from public.members where id = p_member_id;
  delete from public.user_household_context where user_id = v_target.user_id and household_id = v_hid;
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_hid, v_actor, 'member.removed', 'member', p_member_id::text, 'Coordinator removed a member.');
end;
$$;
revoke all on function public.remove_member(uuid) from public;
grant execute on function public.remove_member(uuid) to authenticated;

-- ============ dissolve_household：协调人解散家庭（级联删除全部数据）============
create or replace function public.dissolve_household()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hid uuid := public.current_household_id();
  v_actor uuid := public.current_member_id();
begin
  if v_actor is null or not public.is_coordinator() then
    raise exception 'Only a coordinator can dissolve the household';
  end if;
  -- 级联删除：members/tasks/events/documents/audit_events/household_codes 等随 household 删除。
  delete from public.households where id = v_hid;
end;
$$;
revoke all on function public.dissolve_household() from public;
grant execute on function public.dissolve_household() to authenticated;

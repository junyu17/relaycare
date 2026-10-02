-- 0059: 加入申请 + join_by_code_v2（TestFlight 之前上，兼容 1.9；决策 2B）
--
-- 平时凭码即时加入，和现在一样；全站熔断（0057：15 分钟内输错 ≥30 次）后的 30 分钟里，
-- v2 不再拒绝，而是写一条加入申请，等该户 active 协调人同意。被攻击期间猜中码也拿不到数据：
-- 申请处于 pending 时不写 members，current_household_id() 不会指向这一户，申请人看不到
-- 任何家庭数据，my_join_requests() 也不返回家庭名。
--
-- 旧的 join_by_code 保持 0057 的行为，熔断中仍然报 'Too many join attempts…'：1.9 协调人没有
-- 审批界面，给 1.9 加入者一个看得懂的提示，比让申请悄悄挂着更好。
--
-- 约束：每个 uid 同一时间最多一条 pending（唯一部分索引，同时保证每个 (household, uid) 最多一条）；
-- 每户最多 5 条 pending（在 household_join advisory lock 内计数）；超过 24 小时视为过期
-- （查询时按时间判定，写路径顺带把过期的 pending 改成 expired）。
--
-- join_by_code_v2 返回 jsonb {status, household_id?, request_id?}：
--   joined          已加入（household_id）
--   pending         熔断中，已提交申请（request_id）
--   already_pending 熔断中，这个 uid 已经有一条未过期的 pending（request_id 是那一条）。不看码就返回
--   invalid         码不存在或已过期（不区分两者，都计入失败）
--   rate_limited    每 uid 15 分钟 5 次已用完
--   requests_full   该户 pending 申请已满 5 条
-- 其余情况 RAISE 英文 message + hint：not_authenticated / join_code_format / join_member_limit /
--   join_already_member / join_request_not_found / join_request_closed /
--   join_request_expired / coordinator_required / name_too_long
--
-- 熔断期间不能有「探测码是否有效」的旁路（评审 major）：
--   - 已有 pending 的 uid 再提交任何码，都在查码之前返回 already_pending：回答与码是否有效无关，
--     也不 RAISE，所以这次尝试照样计入「每 uid 15 分钟 5 次」。一个 uid 同一时间只挂一条申请：
--     猜中一户就会写申请、通知那一户的协调人；在这条申请被处理或过期之前，它再提交什么码都得不到信息。
--   - 每 uid 的计数只在 joined 时清零；pending / already_pending 都不清零，
--     否则拿一个已知码（同伙的码，或自己猜中的第一户）反复提交就能无限续命。
--   - requests_full 只会出现在已经有 5 条 pending（协调人都看得到）的家庭，不是扫码的旁路。
--
-- 申请表的读取：只有该户 active 协调人能直接 select（首页横幅和成员页，以及 realtime）。
-- 申请人自己不能直接读表：表里有 household_id 和 decided_by，直接读就绕过了 my_join_requests() 对
-- 家庭身份的隐藏。申请人只通过 my_join_requests() 查状态（等待页每 5 秒轮询，不用 realtime）。
--
-- 新通知文案键（1.10 客户端需要加 i18n）：notification.title.joinRequested / notification.body.joinRequested。
-- 与线上 1.9 的兼容缺口（接受，记在方案 risks）：1.9 的词典里没有这两个键，makeTranslator 会原样显示键名；
-- 1.9 协调人也没有审批界面。熔断期间 1.10 加入者凭码申请一个协调人仍在用 1.9 的家庭时，协调人看到的是
-- 键名，申请会等到 24 小时过期。1.10 的等待页因此提示申请人「对方看不到申请就请他先更新 TaskKin」。

-- ============ household_join_requests ============
create table if not exists public.household_join_requests (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.members(id) on delete set null
);
-- 每个 uid 同一时间最多一条 pending（也就保证了每个 (household_id, user_id) 最多一条）。
create unique index if not exists household_join_requests_one_pending_per_user
  on public.household_join_requests (user_id) where status = 'pending';
create index if not exists household_join_requests_household_status_idx
  on public.household_join_requests (household_id, status, created_at desc);

alter table public.household_join_requests enable row level security;
-- 只开放 select（RLS 过滤）；写入只能走下面的 RPC。
revoke all on table public.household_join_requests from anon, authenticated;
grant select on table public.household_join_requests to authenticated;

-- RLS 辅助：调用者是否为该户 active 协调人（definer 读取 members，避免 members RLS 只放行
-- current_household_id() 导致多家庭协调人看不到非当前家庭的申请）。
create or replace function public.is_active_coordinator_of(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members m
    where m.household_id = p_household_id
      and m.user_id = auth.uid()
      and m.role = 'coordinator'
      and m.invite_status = 'active'
  );
$$;
revoke all on function public.is_active_coordinator_of(uuid) from public;
revoke all on function public.is_active_coordinator_of(uuid) from anon;
grant execute on function public.is_active_coordinator_of(uuid) to authenticated;

-- 不给申请人开放直接 select（见头注释）：申请人只能通过 my_join_requests() 查状态。
drop policy if exists "join_requests: requester select own" on public.household_join_requests;

drop policy if exists "join_requests: coordinator select household" on public.household_join_requests;
create policy "join_requests: coordinator select household" on public.household_join_requests
  for select to authenticated
  using (public.is_active_coordinator_of(household_id));

alter publication supabase_realtime add table public.household_join_requests;

-- ============ join_by_code_v2 ============
create or replace function public.join_by_code_v2(
  p_code text,
  p_display_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code public.household_codes%rowtype;
  v_att public.join_attempts%rowtype;
  v_window_expired boolean;
  v_name text;
  v_member_id uuid;
  v_count int;
  v_limit int;
  v_pending public.household_join_requests%rowtype;
  v_request_id uuid;
  v_tripped boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using hint = 'not_authenticated';
  end if;
  if p_code is null or p_code !~ '^[0-9]{6}$' then
    raise exception 'Code must be 6 digits' using hint = 'join_code_format';
  end if;
  v_name := coalesce(nullif(trim(p_display_name), ''), 'Family member');
  if char_length(v_name) > 80 then
    raise exception 'Name is too long (max 80 characters)' using hint = 'name_too_long';
  end if;

  -- 1) 每 uid 15 分钟 5 次（与 0057 共用 join_attempts）。
  insert into public.join_attempts (user_id, attempts, window_start)
  values (v_uid, 0, now())
  on conflict (user_id) do nothing;
  select * into v_att from public.join_attempts where user_id = v_uid for update;
  v_window_expired := now() - v_att.window_start > interval '15 minutes';
  if not v_window_expired and v_att.attempts >= 5 then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  -- 2) uid 计数 +1。
  if v_window_expired then
    update public.join_attempts set attempts = 1, window_start = now() where user_id = v_uid;
  else
    update public.join_attempts set attempts = attempts + 1 where user_id = v_uid;
  end if;

  -- 3) 熔断中：这个 uid 已有未过期的 pending 时，查码之前就返回 already_pending。
  --    回答与码是否有效无关，也不 RAISE（上面的 +1 照常提交），所以不能借它探测别人家的码。
  --    熔断状态只读一次，下面写申请还是直接加入都按这一次的判断走。
  v_tripped := public.join_breaker_tripped();
  if v_tripped then
    -- 顺带把这个 uid 已过期的 pending 标成 expired，免得占住唯一索引。
    update public.household_join_requests
      set status = 'expired', decided_at = now()
      where user_id = v_uid
        and status = 'pending'
        and created_at <= now() - interval '24 hours';
    select * into v_pending
      from public.household_join_requests
      where user_id = v_uid and status = 'pending';
    if found then
      return jsonb_build_object('status', 'already_pending', 'request_id', v_pending.id);
    end if;
  end if;

  -- 4) 查码：不存在或已过期都返回 invalid（不区分），并计入全站失败。
  select * into v_code from public.household_codes where code = p_code and status = 'active' for update;
  if not found or v_code.expires_at <= now() then
    if found then
      update public.household_codes set status = 'locked' where id = v_code.id;
    end if;
    perform public.join_record_failure();
    return jsonb_build_object('status', 'invalid');
  end if;

  -- 与 join_by_code / approve_join_request 串行化（成员数上限、pending 上限）。
  perform pg_advisory_xact_lock(hashtext('household_join:' || v_code.household_id::text));

  if exists (
    select 1 from public.members
    where household_id = v_code.household_id
      and user_id = v_uid
      and invite_status = 'active'
  ) then
    raise exception 'You are already a member of this household' using hint = 'join_already_member';
  end if;

  -- 5) 熔断中、码有效：只写申请，不写 members；通知该户协调人。uid 计数不清零。
  if v_tripped then
    -- 这一户已过期的 pending 标成 expired，免得占住每户 5 条的名额。
    update public.household_join_requests
      set status = 'expired', decided_at = now()
      where household_id = v_code.household_id
        and status = 'pending'
        and created_at <= now() - interval '24 hours';

    select count(*) into v_count
      from public.household_join_requests
      where household_id = v_code.household_id and status = 'pending';
    if v_count >= 5 then
      return jsonb_build_object('status', 'requests_full');
    end if;

    insert into public.household_join_requests (household_id, user_id, display_name)
    values (v_code.household_id, v_uid, v_name)
    returning id into v_request_id;

    insert into public.role_notifications (household_id, audience, severity, title_key, body_key, values, entity_type, entity_id)
    values (v_code.household_id, 'coordinator', 'info', 'notification.title.joinRequested', 'notification.body.joinRequested',
            jsonb_build_object('name', v_name), 'join_request', v_request_id::text);

    return jsonb_build_object('status', 'pending', 'request_id', v_request_id);
  end if;

  -- 6) 没熔断：直接加入，逻辑与 join_by_code 相同。
  select count(*) into v_count
    from public.members
    where household_id = v_code.household_id
      and invite_status <> 'removed';
  v_limit := case when public.effective_plan(v_code.household_id) in ('monthly','yearly') then 12 else 3 end;
  if v_count >= v_limit then
    raise exception 'Household member limit reached (%)', v_limit using hint = 'join_member_limit';
  end if;

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

  -- 之前熔断期间留下的同户 pending 申请随之结束。
  update public.household_join_requests
    set status = 'approved', decided_at = now()
    where user_id = v_uid and household_id = v_code.household_id and status = 'pending';

  -- 只有真正加入才清零 uid 计数。
  update public.join_attempts set attempts = 0 where user_id = v_uid;
  return jsonb_build_object('status', 'joined', 'household_id', v_code.household_id);
end;
$$;
revoke all on function public.join_by_code_v2(text, text) from public;
revoke all on function public.join_by_code_v2(text, text) from anon;
grant execute on function public.join_by_code_v2(text, text) to authenticated;

-- ============ approve_join_request ============
create or replace function public.approve_join_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_request public.household_join_requests%rowtype;
  v_actor public.members%rowtype;
  v_member_id uuid;
  v_count int;
  v_limit int;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using hint = 'not_authenticated';
  end if;

  select * into v_request from public.household_join_requests where id = p_request_id;
  if not found then
    raise exception 'Join request not found' using hint = 'join_request_not_found';
  end if;

  select * into v_actor
    from public.members
    where household_id = v_request.household_id
      and user_id = v_uid
      and invite_status = 'active'
    limit 1;
  if not found or v_actor.role <> 'coordinator' then
    raise exception 'Only a coordinator can approve join requests' using hint = 'coordinator_required';
  end if;

  -- 与 join_by_code / v2 用同一把锁：复查人数上限和是否已是成员。
  perform pg_advisory_xact_lock(hashtext('household_join:' || v_request.household_id::text));
  select * into v_request from public.household_join_requests where id = p_request_id for update;
  if not found then
    raise exception 'Join request not found' using hint = 'join_request_not_found';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This join request is no longer pending' using hint = 'join_request_closed';
  end if;
  if v_request.created_at <= now() - interval '24 hours' then
    raise exception 'This join request has expired' using hint = 'join_request_expired';
  end if;

  if exists (
    select 1 from public.members
    where household_id = v_request.household_id
      and user_id = v_request.user_id
      and invite_status = 'active'
  ) then
    update public.household_join_requests
      set status = 'approved', decided_at = now(), decided_by = v_actor.id
      where id = v_request.id;
    return v_request.household_id;
  end if;

  select count(*) into v_count
    from public.members
    where household_id = v_request.household_id
      and invite_status <> 'removed';
  v_limit := case when public.effective_plan(v_request.household_id) in ('monthly','yearly') then 12 else 3 end;
  if v_count >= v_limit then
    raise exception 'Household member limit reached (%)', v_limit using hint = 'join_member_limit';
  end if;

  insert into public.members (household_id, user_id, name, relation, role, timezone, invite_status)
  values (v_request.household_id, v_request.user_id, v_request.display_name, '', 'caregiver', 'America/Los_Angeles', 'active')
  returning id into v_member_id;
  insert into public.notification_preferences (household_id, member_id) values (v_request.household_id, v_member_id);

  insert into public.user_household_context (user_id, household_id, updated_at)
  values (v_request.user_id, v_request.household_id, now())
  on conflict (user_id) do update set household_id = excluded.household_id, updated_at = now();

  update public.household_join_requests
    set status = 'approved', decided_at = now(), decided_by = v_actor.id
    where id = v_request.id;

  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_request.household_id, v_actor.id, 'member.join_approved', 'member', v_member_id::text,
          v_actor.name || ' approved a join request.');
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_request.household_id, v_member_id, 'member.joined', 'member', v_member_id::text,
          v_request.display_name || ' joined the household by code.');

  insert into public.role_notifications (household_id, audience, severity, title_key, body_key, values, entity_type, entity_id)
  values (v_request.household_id, 'coordinator', 'info', 'notification.title.memberJoined', 'notification.body.memberJoined',
          jsonb_build_object('name', v_request.display_name), 'member', v_member_id::text);

  return v_request.household_id;
end;
$$;
revoke all on function public.approve_join_request(uuid) from public;
revoke all on function public.approve_join_request(uuid) from anon;
grant execute on function public.approve_join_request(uuid) to authenticated;

-- ============ reject_join_request ============
create or replace function public.reject_join_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_request public.household_join_requests%rowtype;
  v_actor public.members%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using hint = 'not_authenticated';
  end if;

  select * into v_request from public.household_join_requests where id = p_request_id for update;
  if not found then
    raise exception 'Join request not found' using hint = 'join_request_not_found';
  end if;

  select * into v_actor
    from public.members
    where household_id = v_request.household_id
      and user_id = v_uid
      and invite_status = 'active'
    limit 1;
  if not found or v_actor.role <> 'coordinator' then
    raise exception 'Only a coordinator can reject join requests' using hint = 'coordinator_required';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This join request is no longer pending' using hint = 'join_request_closed';
  end if;

  update public.household_join_requests
    set status = 'rejected', decided_at = now(), decided_by = v_actor.id
    where id = v_request.id;

  -- 审计不写申请人填的名字（他不是成员，删号流程也不会去匿名化这条记录）。
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_request.household_id, v_actor.id, 'member.join_rejected', 'join_request', v_request.id::text,
          v_actor.name || ' declined a join request.');
end;
$$;
revoke all on function public.reject_join_request(uuid) from public;
revoke all on function public.reject_join_request(uuid) from anon;
grant execute on function public.reject_join_request(uuid) to authenticated;

-- ============ my_join_requests：申请人查自己的申请 ============
-- pending / rejected / expired 时不返回家庭名和 household_id，避免猜中码的人借此确认是哪一户；
-- 只有 approved（已经是成员）才返回。
create or replace function public.my_join_requests()
returns table (
  id uuid,
  status text,
  created_at timestamptz,
  decided_at timestamptz,
  household_id uuid,
  household_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id,
         case when r.status = 'pending' and r.created_at <= now() - interval '24 hours' then 'expired' else r.status end,
         r.created_at,
         r.decided_at,
         case when r.status = 'approved' then r.household_id end,
         case when r.status = 'approved' then h.name end
    from public.household_join_requests r
    left join public.households h on h.id = r.household_id
    where r.user_id = auth.uid()
      and r.created_at > now() - interval '30 days'
    order by r.created_at desc
    limit 20;
$$;
revoke all on function public.my_join_requests() from public;
revoke all on function public.my_join_requests() from anon;
grant execute on function public.my_join_requests() to authenticated;

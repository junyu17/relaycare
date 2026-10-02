-- 0058: 协调人转让 + 续费连续性 + Apple 身份冲突辅助函数（TestFlight 之前上，兼容 1.9）
--
-- 1. is_bound_user(uid)：「已绑定」的唯一判断，只读 auth.users / auth.identities，不读 JWT
--    （JWT 里的 is_anonymous 要等刷新才更新）。已绑定 = 下面两条之一：
--      a) 有 provider='apple' 的 identity。只能经过校验 Apple id_token 才能挂上，所以单独成立；
--         即使 linkIdentity 之后 GoTrue 没把 is_anonymous 改成 false，也判为已绑定。
--      b) is_anonymous=false、有 provider='email' 的 identity、并且设置了密码。
--         匿名用户 PUT /user 只设邮箱不设密码（enable_confirmations=false 时 GoTrue 会自动确认）
--         不算已绑定；老的邮箱 + 密码协调人不受影响。
-- 2. transfer_coordinator(member_id)：active 协调人把协调人角色交给同户已绑定的 active 成员，
--    自己改为 caregiver（匿名协调人也可以调用：这是 1.9 遗留匿名协调人的恢复路径）。
-- 3. 续费连续性：0013 的 sync_subscription_by_transaction 和 0035 的 sync_subscription_state
--    要求付款人仍是该户 active coordinator，转让 / 退出 / 被移除 / 删号之后 Apple 照常扣费，
--    家庭却掉回 Free。改为按 subscription_households 重算这份订阅覆盖的每个家庭：
--    取覆盖该户、status='active' 且 expires_at>now() 的订阅中到期最晚的一份；没有就降为 Free。
--    所以 A 的订阅过期不会清掉 B 另外买的 Plus。plus_owner_id 只用于展示
--    （effective_plan 只看 plus_plan / plus_until），取付款人在该户的 active 成员行，没有就 NULL。
-- 4. get_my_subscription_status(household_id)：只返回调用者本人（owner_user_id 或
--    owner_app_account_token = auth.uid()）对这个家庭是否有有效订阅，客户端在转让、退出、
--    删号前据此提示「Apple 会继续扣费」。不要求仍是成员：被移除的付款人也要能查到。
-- 5. Apple 身份冲突辅助函数（只给 service_role，供 apple-identity-conflict Edge Function）：
--    apple_identity_owner / account_has_data / delete_auth_user_if_empty。
--    delete_auth_user_if_empty 先锁 auth.users 行再复查：并发的 join / create 插入成员行时要对
--    这一行取 KEY SHARE 锁，所以要么先提交、被复查看到而拒绝删除，要么等删除提交后因外键失败，
--    不会出现「数据刚写进来账号就被删、成员行 user_id 被置空」。
--
-- 6. 再执行一次 0057 第 7 条的 upsert_subscription revoke（幂等）：如果 0057 在加入那一节之前
--    就已经推到线上，db push 不会重跑 0057，订阅伪造口子要靠这里关上。
--
-- 所有 RAISE 保留英文 message，另带稳定 hint：
--   not_authenticated / member_not_found / coordinator_required / transfer_to_self / target_not_bound

-- ============ upsert_subscription：与 0057 相同的 revoke（幂等的安全网）============
revoke all on function public.upsert_subscription(uuid, text, text, timestamptz, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.upsert_subscription(uuid, text, text, timestamptz, text, text, text, uuid)
  to service_role;

-- ============ is_bound_user ============
create or replace function public.is_bound_user(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select exists (
             select 1 from auth.identities i
             where i.user_id = u.id and i.provider = 'apple'
           )
        or (
             u.is_anonymous = false
             and coalesce(u.encrypted_password, '') <> ''
             and exists (
               select 1 from auth.identities i
               where i.user_id = u.id and i.provider = 'email'
             )
           )
      from auth.users u
      where u.id = p_uid
  ), false);
$$;
revoke all on function public.is_bound_user(uuid) from public, anon, authenticated;
grant execute on function public.is_bound_user(uuid) to service_role;

-- ============ transfer_coordinator ============
create or replace function public.transfer_coordinator(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_household_id uuid;
  v_actor public.members%rowtype;
  v_target public.members%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using hint = 'not_authenticated';
  end if;

  select household_id into v_household_id
    from public.members
    where id = p_member_id;
  if not found then
    raise exception 'Member not found in this household' using hint = 'member_not_found';
  end if;

  -- 同一户的角色变更串行化（并发的两次转让不会产生两个协调人或零个协调人）。
  perform pg_advisory_xact_lock(hashtext('household_role:' || v_household_id::text));

  select * into v_actor
    from public.members
    where household_id = v_household_id
      and user_id = v_uid
      and invite_status = 'active'
    limit 1
    for update;
  if not found or v_actor.role <> 'coordinator' then
    raise exception 'Only a coordinator can transfer the coordinator role' using hint = 'coordinator_required';
  end if;

  select * into v_target
    from public.members
    where id = p_member_id
    for update;
  if not found or v_target.invite_status <> 'active' then
    raise exception 'Member not found in this household' using hint = 'member_not_found';
  end if;
  if v_target.id = v_actor.id then
    raise exception 'You are already the coordinator' using hint = 'transfer_to_self';
  end if;
  if v_target.user_id is null or not public.is_bound_user(v_target.user_id) then
    raise exception 'The new coordinator must sign in with Apple first.' using hint = 'target_not_bound';
  end if;

  -- 同一事务里互换角色（definer 以 postgres 执行，不受 guard_member_key_columns 限制）。
  update public.members set role = 'coordinator' where id = v_target.id;
  update public.members set role = 'caregiver' where id = v_actor.id;

  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (
    v_household_id,
    v_actor.id,
    'member.coordinator_transferred',
    'member',
    v_target.id::text,
    v_actor.name || ' transferred the coordinator role to ' || v_target.name || '.'
  );

  -- 通知目标：沿用 roleUpdated 文案键，1.9 和 1.10 都能显示。
  insert into public.role_notifications (household_id, audience, severity, title_key, body_key, values, entity_type, entity_id)
  values (
    v_household_id,
    'coordinator',
    'info',
    'notification.title.roleUpdated',
    'notification.body.roleUpdated',
    jsonb_build_object('name', v_target.name, 'target', v_target.name, 'role', 'coordinator'),
    'member',
    v_target.id::text
  );
end;
$$;
revoke all on function public.transfer_coordinator(uuid) from public;
revoke all on function public.transfer_coordinator(uuid) from anon;
grant execute on function public.transfer_coordinator(uuid) to authenticated;

-- ============ refresh_household_plus：按覆盖该户的有效订阅重算权益（内部函数）============
create or replace function public.refresh_household_plus(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_expires_at timestamptz;
  v_owner_user_id uuid;
  v_owner_member_id uuid;
begin
  select s.plan, s.expires_at, s.owner_user_id
    into v_plan, v_expires_at, v_owner_user_id
    from public.subscription_households sh
    join public.subscriptions s on s.id = sh.subscription_id
    where sh.household_id = p_household_id
      and s.status = 'active'
      and s.expires_at > now()
    order by s.expires_at desc
    limit 1;

  if not found then
    update public.households
      set plus_plan = 'free', plus_until = null, plus_owner_id = null
      where id = p_household_id;
    return;
  end if;

  -- 付款人在该户的 active 成员行（只用于展示）；已转让 / 退出 / 被移除 / 删号则为 NULL。
  select m.id into v_owner_member_id
    from public.members m
    where m.household_id = p_household_id
      and m.user_id = v_owner_user_id
      and m.invite_status = 'active'
    order by (m.role = 'coordinator') desc, m.created_at asc
    limit 1;

  update public.households
    set plus_plan = v_plan, plus_until = v_expires_at, plus_owner_id = v_owner_member_id
    where id = p_household_id;
end;
$$;
revoke all on function public.refresh_household_plus(uuid) from public, anon, authenticated;

-- ============ sync_subscription_by_transaction（Apple Server Notifications）============
create or replace function public.sync_subscription_by_transaction(
  p_original_transaction_id text,
  p_plan text,
  p_expires_at timestamptz,
  p_status text,
  p_last_transaction_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_household_id uuid;
begin
  select * into v_sub from public.subscriptions where original_transaction_id = p_original_transaction_id;
  if not found then return; end if;

  update public.subscriptions
    set plan = p_plan,
        expires_at = p_expires_at,
        status = p_status,
        last_transaction_id = p_last_transaction_id,
        updated_at = now()
    where id = v_sub.id;

  -- 不再要求付款人仍是该户 active coordinator：按这份订阅覆盖的家庭逐一重算。
  for v_household_id in
    select sh.household_id from public.subscription_households sh where sh.subscription_id = v_sub.id
  loop
    perform public.refresh_household_plus(v_household_id);
  end loop;
end;
$$;
revoke all on function public.sync_subscription_by_transaction(text, text, timestamptz, text, text) from public;
revoke all on function public.sync_subscription_by_transaction(text, text, timestamptz, text, text) from anon;
revoke all on function public.sync_subscription_by_transaction(text, text, timestamptz, text, text) from authenticated;
grant execute on function public.sync_subscription_by_transaction(text, text, timestamptz, text, text) to service_role;

-- ============ sync_subscription_state（Google RTDN）============
create or replace function public.sync_subscription_state(
  p_original_transaction_id text,
  p_status text,
  p_plan text,
  p_expires_at timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_household_id uuid;
begin
  if p_status not in ('active', 'expired', 'revoked', 'canceled') then
    raise exception 'Invalid subscription status';
  end if;
  if p_plan is null then
    -- 调用方未传 plan 时回退记录值（防御传播缺陷）
    select plan into p_plan from public.subscriptions where original_transaction_id = p_original_transaction_id;
  end if;
  if p_plan not in ('monthly', 'yearly') then
    raise exception 'Invalid plan';
  end if;

  select * into v_sub from public.subscriptions
    where original_transaction_id = p_original_transaction_id
    limit 1;
  if not found then
    raise exception 'Subscription not found';
  end if;

  update public.subscriptions
    set status = p_status,
        plan = p_plan,
        expires_at = p_expires_at,
        updated_at = now()
    where id = v_sub.id;

  for v_household_id in
    select sh.household_id from public.subscription_households sh where sh.subscription_id = v_sub.id
    union
    select v_sub.household_id where v_sub.household_id is not null
  loop
    perform public.refresh_household_plus(v_household_id);
  end loop;
end;
$$;
revoke all on function public.sync_subscription_state(text, text, text, timestamptz) from public;
revoke all on function public.sync_subscription_state(text, text, text, timestamptz) from anon;
revoke all on function public.sync_subscription_state(text, text, text, timestamptz) from authenticated;
grant execute on function public.sync_subscription_state(text, text, text, timestamptz) to service_role;

-- ============ get_my_subscription_status ============
create or replace function public.get_my_subscription_status(p_household_id uuid)
returns table (is_paying boolean, plan text, expires_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select s.plan, s.expires_at
      from public.subscriptions s
      join public.subscription_households sh on sh.subscription_id = s.id
      where sh.household_id = p_household_id
        and auth.uid() is not null
        and (s.owner_user_id = auth.uid() or s.owner_app_account_token = auth.uid())
        and s.status = 'active'
        and s.expires_at > now()
      order by s.expires_at desc
      limit 1
  )
  select exists (select 1 from mine), (select m.plan from mine m), (select m.expires_at from mine m);
$$;
revoke all on function public.get_my_subscription_status(uuid) from public;
revoke all on function public.get_my_subscription_status(uuid) from anon;
grant execute on function public.get_my_subscription_status(uuid) to authenticated;

-- ============ Apple 身份冲突辅助函数（仅 service_role）============
create or replace function public.apple_identity_owner(p_sub text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select i.user_id
    from auth.identities i
    where i.provider = 'apple' and i.provider_id = p_sub
    limit 1;
$$;
revoke all on function public.apple_identity_owner(text) from public, anon, authenticated;
grant execute on function public.apple_identity_owner(text) to service_role;

-- 「有数据」= 有成员关系（任何状态、任何角色），或名下有订阅（含已删号后保留的 app account token）。
create or replace function public.account_has_data(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.members m where m.user_id = p_uid)
      or exists (
           select 1 from public.subscriptions s
           where s.owner_user_id = p_uid or s.owner_app_account_token = p_uid
         );
$$;
revoke all on function public.account_has_data(uuid) from public, anon, authenticated;
grant execute on function public.account_has_data(uuid) to service_role;

-- 只删「空账号」：有 Apple identity、没有其他 identity、没有密码、account_has_data 为假。
-- 返回 true = 已删除；false = 不满足条件，什么都没删；
-- NULL = 条件满足，但数据库角色没有 auth.users 的 DELETE 权限，需由调用方改用
--        Admin API（admin.deleteUser）删除——此时复查与删除之间有毫秒级窗口（见 0058 头注释与方案 risks）。
create or replace function public.delete_auth_user_if_empty(p_uid uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_password text;
begin
  if p_uid is null then
    return false;
  end if;

  begin
    select u.encrypted_password into v_password from auth.users u where u.id = p_uid for update;
  exception when insufficient_privilege then
    -- 没有行锁权限时退化为不加锁的读取，删除也会走 Admin API（返回 NULL）。
    select u.encrypted_password into v_password from auth.users u where u.id = p_uid;
  end;
  if not found then
    return false;
  end if;

  if coalesce(v_password, '') <> '' then
    return false;
  end if;
  if public.account_has_data(p_uid) then
    return false;
  end if;
  if not exists (select 1 from auth.identities i where i.user_id = p_uid and i.provider = 'apple') then
    return false;
  end if;
  if exists (select 1 from auth.identities i where i.user_id = p_uid and i.provider <> 'apple') then
    return false;
  end if;

  begin
    delete from auth.users where id = p_uid;
  exception when insufficient_privilege then
    return null;
  end;
  return true;
end;
$$;
revoke all on function public.delete_auth_user_if_empty(uuid) from public, anon, authenticated;
grant execute on function public.delete_auth_user_if_empty(uuid) to service_role;

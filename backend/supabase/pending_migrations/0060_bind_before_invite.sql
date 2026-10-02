-- 0060: 绑定后才能邀请（服务端强制）
--
-- ⚠ 上线时机：1.10 审核通过当天，先把本文件移进 backend/supabase/migrations/ 并 db push，
--   再在 App Store Connect 点发布。之前一直放在 pending_migrations/，避免更早的 db push 提前应用：
--   报错文案让用户「更新 TaskKin 并用 Apple 登录」，1.10 上架之前这句话不成立。
--   本地 backend/qa/local_pg.sh 会把它和 0061、0062 一起加载并测试。
--
-- 「已绑定」只由 0058 的 is_bound_user 判断（apple identity，或 非匿名 + email identity + 密码），
-- 不读 JWT 里的 is_anonymous（要等刷新才更新，最长 3600 秒），客户端判断只用来决定界面。
-- 决策 4A：1.9 时期已经当了协调人的匿名用户没有豁免，必须先绑定才能生成码；
-- 他们可以用 0058 的 transfer_coordinator 把协调人交给已绑定的家人。
--
-- 匿名（未绑定）用户可以：
--   创建家庭并成为协调人；按自己的角色使用家庭内全部功能；凭码加入或提交加入申请；
--   退出家庭；改名；改通知偏好；删除账号；把协调人转让给已绑定的成员。
-- 匿名（未绑定）用户不可以：
--   生成或查看加入码（本文件 ① ②）；被提升为协调人或接收转让（本文件 ④、0058）。
--   旧的邀请 token 入口 invite_member / create_invite 对所有客户端 revoke（本文件 ③）。
--   购买和恢复购买的拦截在客户端、StoreKit 之前执行（服务端校验发生在扣款之后，不在这里拒绝）。
--
-- 新 hint：account_binding_required / target_not_bound（message 保留英文，1.9 可以直接显示）。

-- ① generate_household_code：协调人校验之后要求已绑定，仍用 CSPRNG 出码（同 0057）。
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
  if not public.is_bound_user(auth.uid()) then
    raise exception 'To invite family, update TaskKin and sign in with Apple.'
      using hint = 'account_binding_required';
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

-- ② get_household_code：未绑定时返回空结果，不 RAISE（1.9 的面板读不到码时显示空，不弹错）。
create or replace function public.get_household_code()
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare v_hid uuid := public.current_household_id();
begin
  if v_hid is null or not public.is_coordinator() then
    raise exception 'Only a coordinator can view the join code' using hint = 'coordinator_required';
  end if;
  if not public.is_bound_user(auth.uid()) then
    return;
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
revoke all on function public.get_household_code() from anon;
grant execute on function public.get_household_code() to authenticated;

-- ③ 旧的邀请 token 入口：客户端只在 src/lib/actions.ts 的 inviteMember 里引用，App.tsx 不调用。
--    revoke 之后只剩 6 位码一条邀请路径，绑定要求无法绕过。
revoke all on function public.invite_member(uuid, text) from public, anon, authenticated;
revoke all on function public.create_invite(uuid) from public, anon, authenticated;

-- ④ update_member_role：提升为协调人时目标必须已绑定；与 transfer_coordinator 共用角色锁。
create or replace function public.update_member_role(
  p_member_id uuid,
  p_role text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_actor public.members%rowtype;
  v_target public.members%rowtype;
begin
  if v_uid is null then raise exception 'Not authenticated' using hint = 'not_authenticated'; end if;
  if p_role not in ('coordinator', 'caregiver', 'viewer') then raise exception 'Invalid role' using hint = 'invalid_role'; end if;

  select * into v_target
    from public.members
    where id = p_member_id
      and invite_status = 'active';
  if not found then raise exception 'Member not found in this household' using hint = 'member_not_found'; end if;

  perform pg_advisory_xact_lock(hashtext('household_role:' || v_target.household_id::text));

  select * into v_actor
    from public.members
    where household_id = v_target.household_id
      and user_id = v_uid
      and invite_status = 'active'
    limit 1;
  if not found or v_actor.role <> 'coordinator' then
    raise exception 'Only a coordinator can change member roles' using hint = 'coordinator_required';
  end if;
  if v_actor.id = v_target.id then
    raise exception 'Cannot change your own role' using hint = 'cannot_change_own_role';
  end if;
  if p_role = 'coordinator' and (v_target.user_id is null or not public.is_bound_user(v_target.user_id)) then
    raise exception 'The new coordinator must sign in with Apple first.' using hint = 'target_not_bound';
  end if;

  update public.members
    set role = p_role
    where id = p_member_id;

  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (
    v_target.household_id,
    v_actor.id,
    'member.role_updated',
    'member',
    p_member_id::text,
    v_actor.name || ' changed ' || v_target.name || '''s role to ' || p_role || '.'
  );

  insert into public.role_notifications (household_id, audience, severity, title_key, body_key, values, entity_type, entity_id)
  values (
    v_target.household_id,
    p_role,
    'info',
    'notification.title.roleUpdated',
    'notification.body.roleUpdated',
    jsonb_build_object('name', v_target.name, 'role', p_role),
    'member',
    p_member_id::text
  );
end;
$$;
revoke all on function public.update_member_role(uuid, text) from public;
revoke all on function public.update_member_role(uuid, text) from anon;
grant execute on function public.update_member_role(uuid, text) to authenticated;

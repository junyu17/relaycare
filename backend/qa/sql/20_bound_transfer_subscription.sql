-- ============================================================================
-- 0058 协调人转让 + 续费连续性 + Apple 身份冲突辅助函数：本地回归测试
-- ============================================================================

-- [20.1] is_bound_user 真值表（只读 auth.users / auth.identities，不读 JWT）
-- 先在单独的语句里建用户：STABLE 函数用的是所在语句开始时的快照，同一条语句里刚插入的行看不到。
do $$
declare
  v_anon uuid := qa.user('anonymous');
  v_anon_email uuid := qa.user('anonymous_email_no_password');
  v_email_nopass uuid := qa.user('email_no_password');
  v_email_pass uuid := qa.user('email_password');
  v_apple uuid := qa.user('apple');
  v_anon_apple uuid := qa.user('anonymous_apple');
begin
  perform qa.check(public.is_bound_user(v_anon) = false, 'pure anonymous → false');
  perform qa.check(public.is_bound_user(v_anon_email) = false, 'anonymous + email identity, no password → false');
  perform qa.check(public.is_bound_user(v_email_nopass) = false,
                   'PUT /user email without password (is_anonymous=false) → false');
  perform qa.check(public.is_bound_user(v_email_pass) = true, 'email + password → true');
  perform qa.check(public.is_bound_user(v_apple) = true, 'apple identity → true');
  perform qa.check(public.is_bound_user(v_anon_apple) = true,
                   'apple identity while is_anonymous is still true → true (design premise)');
  perform qa.check(public.is_bound_user(gen_random_uuid()) = false, 'unknown uid → false');
  perform qa.check(public.is_bound_user(null) = false, 'null → false');
  perform qa.denied(qa.call(qa.user('apple'), format('select public.is_bound_user(%L)::text', gen_random_uuid())),
                    'authenticated cannot call is_bound_user');
  perform qa.check(qa.ok(qa.call(null, format('select public.is_bound_user(%L)::text', gen_random_uuid()), 'service_role'),
                         'service_role can call is_bound_user') = 'false', 'service_role result');
  perform qa.pass('[20.1] is_bound_user truth table');
end $$;

-- [20.2] transfer_coordinator：五种拒绝
do $$
declare
  v_a uuid := qa.user('anonymous');          -- 1.9 遗留的匿名协调人
  v_b uuid := qa.user('apple');
  v_u uuid := qa.user('anonymous');
  v_r uuid := qa.user('apple');
  v_z uuid := qa.user('apple');
  v_hid uuid := qa.household(v_a, 'Transfer home');
  v_h2 uuid := qa.household(qa.user('apple'), 'Other home');
  v_ma uuid;
  v_mb uuid;
  v_mu uuid;
  v_mr uuid;
  v_mz uuid;
begin
  v_ma := qa.member_id(v_hid, v_a);
  v_mb := qa.add_member(v_hid, v_b, 'caregiver', 'Bea');
  v_mu := qa.add_member(v_hid, v_u, 'caregiver', 'Uma');
  v_mr := qa.add_member(v_hid, v_r, 'caregiver', 'Rex', 'removed');
  v_mz := qa.add_member(v_h2, v_z, 'caregiver', 'Zed');

  perform qa.err(qa.call(v_b, format('select public.transfer_coordinator(%L)::text', v_mu)),
                 'coordinator_required', 'caller is not the coordinator');
  perform qa.err(qa.call(v_a, format('select public.transfer_coordinator(%L)::text', v_ma)),
                 'transfer_to_self', 'target is the caller');
  perform qa.err(qa.call(v_a, format('select public.transfer_coordinator(%L)::text', v_mu)),
                 'target_not_bound', 'target is not bound', 'The new coordinator must sign in with Apple first.');
  perform qa.err(qa.call(v_a, format('select public.transfer_coordinator(%L)::text', v_mz)),
                 'coordinator_required', 'target is in another household');
  perform qa.err(qa.call(v_a, format('select public.transfer_coordinator(%L)::text', v_mr)),
                 'member_not_found', 'target was removed');
  perform qa.err(qa.call(v_a, format('select public.transfer_coordinator(%L)::text', gen_random_uuid())),
                 'member_not_found', 'target does not exist');
  perform qa.check((select role from public.members where id = v_ma) = 'coordinator', 'nothing changed after rejections');
  perform qa.denied(qa.call(null, format('select public.transfer_coordinator(%L)::text', v_mb), 'anon'),
                    'anon cannot call transfer_coordinator');

  perform qa.set('t_a', v_a::text);
  perform qa.set('t_hid', v_hid::text);
  perform qa.set('t_mb', v_mb::text);
  perform qa.pass('[20.2] transfer_coordinator rejects non-coordinator, self, unbound, other household, removed');
end $$;

-- [20.3] 转让成功：角色互换、写审计、通知目标；原协调人随后可以 leave_household
do $$
declare
  v_a uuid := qa.get('t_a')::uuid;
  v_hid uuid := qa.get('t_hid')::uuid;
  v_mb uuid := qa.get('t_mb')::uuid;
  v_ma uuid := qa.member_id(v_hid, v_a);
begin
  perform qa.ok(qa.call(v_a, format('select public.transfer_coordinator(%L)::text', v_mb)), 'anonymous coordinator transfers to bound member');
  perform qa.check((select role from public.members where id = v_mb) = 'coordinator', 'target is coordinator');
  perform qa.check((select role from public.members where id = v_ma) = 'caregiver', 'caller is caregiver');
  perform qa.check(
    (select count(*) from public.members where household_id = v_hid and role = 'coordinator' and invite_status = 'active') = 1,
    'exactly one coordinator'
  );
  perform qa.check(exists (
    select 1 from public.audit_events
    where household_id = v_hid and action = 'member.coordinator_transferred' and actor_id = v_ma and entity_id = v_mb::text
  ), 'audit member.coordinator_transferred');
  perform qa.check(exists (
    select 1 from public.role_notifications
    where household_id = v_hid and audience = 'coordinator' and entity_id = v_mb::text
      and title_key = 'notification.title.roleUpdated'
  ), 'target notified');
  perform qa.ok(qa.call(v_a, format('select public.leave_household(%L)::text', v_hid)), 'former coordinator can leave');
  perform qa.check((select invite_status from public.members where id = v_ma) = 'removed', 'former coordinator left');
  perform qa.pass('[20.3] transfer swaps roles, audits, notifies; former coordinator can leave');
end $$;

-- 续费连续性的公共场景：A（付款人、协调人）+ B（已绑定 caregiver），A 的订阅覆盖 H。
create or replace function qa.sub_setup(p_tag text)
returns void
language plpgsql
as $$
declare
  v_a uuid := qa.user('apple');
  v_b uuid := qa.user('apple');
  v_hid uuid := qa.household(v_a, 'Plus ' || p_tag);
  v_mb uuid := qa.add_member(v_hid, v_b, 'caregiver', 'Bea');
begin
  perform public.register_apple_subscription(
    v_hid, 'otx-' || p_tag, 'monthly', now() + interval '10 days', 'Sandbox', 'tx-1', qa.member_id(v_hid, v_a), v_a
  );
  perform qa.check(public.effective_plan(v_hid) = 'monthly', p_tag || ': household starts on Plus');
  perform qa.set(p_tag || '_a', v_a::text);
  perform qa.set(p_tag || '_b', v_b::text);
  perform qa.set(p_tag || '_hid', v_hid::text);
  perform qa.set(p_tag || '_mb', v_mb::text);
end;
$$;

create or replace function qa.sub_renew_extends(p_tag text)
returns void
language plpgsql
as $$
declare
  v_hid uuid := qa.get(p_tag || '_hid')::uuid;
  v_new timestamptz := date_trunc('second', now() + interval '40 days');
begin
  perform public.sync_subscription_by_transaction('otx-' || p_tag, 'monthly', v_new, 'active', 'tx-2');
  perform qa.check((select plus_until from public.households where id = v_hid) = v_new, p_tag || ': renewal extends plus_until');
  perform qa.check(public.effective_plan(v_hid) = 'monthly', p_tag || ': household stays on Plus');
end;
$$;

-- [20.4] 续费连续性：四种情况之后续费都会延长 H
do $$
declare
  v_a uuid;
  v_b uuid;
  v_hid uuid;
begin
  -- (a) A 转让给 B
  perform qa.sub_setup('ta');
  perform qa.ok(qa.call(qa.get('ta_a')::uuid, format('select public.transfer_coordinator(%L)::text', qa.get('ta_mb'))), 'ta transfer');
  perform qa.sub_renew_extends('ta');
  perform qa.check(
    (select plus_owner_id from public.households where id = qa.get('ta_hid')::uuid)
      = qa.member_id(qa.get('ta_hid')::uuid, qa.get('ta_a')::uuid),
    'ta: payer still a member → plus_owner_id is his member row'
  );

  -- (b) A 转让后退出
  perform qa.sub_setup('tl');
  v_a := qa.get('tl_a')::uuid;
  perform qa.ok(qa.call(v_a, format('select public.transfer_coordinator(%L)::text', qa.get('tl_mb'))), 'tl transfer');
  perform qa.ok(qa.call(v_a, format('select public.leave_household(%L)::text', qa.get('tl_hid'))), 'tl leave');
  perform qa.sub_renew_extends('tl');
  perform qa.check((select plus_owner_id from public.households where id = qa.get('tl_hid')::uuid) is null,
                   'tl: payer left → plus_owner_id is NULL');

  -- (c) A 转让后被 B 移除
  perform qa.sub_setup('rm');
  v_a := qa.get('rm_a')::uuid;
  v_b := qa.get('rm_b')::uuid;
  v_hid := qa.get('rm_hid')::uuid;
  perform qa.ok(qa.call(v_a, format('select public.transfer_coordinator(%L)::text', qa.get('rm_mb'))), 'rm transfer');
  perform qa.ok(qa.call(v_b, format('select public.remove_member(%L)::text', qa.member_id(v_hid, v_a))), 'rm remove');
  perform qa.sub_renew_extends('rm');

  -- (d) A 转让后删号（delete_account_data + 删除 auth 用户 → owner_user_id 置空，token 保留）
  perform qa.sub_setup('del');
  v_a := qa.get('del_a')::uuid;
  perform qa.ok(qa.call(v_a, format('select public.transfer_coordinator(%L)::text', qa.get('del_mb'))), 'del transfer');
  perform public.delete_account_data(v_a);
  delete from auth.users where id = v_a;
  perform qa.check(exists (select 1 from public.households where id = qa.get('del_hid')::uuid), 'del: household kept');
  perform qa.check((select owner_user_id from public.subscriptions where original_transaction_id = 'otx-del') is null,
                   'del: owner_user_id set null by FK');
  perform qa.sub_renew_extends('del');

  perform qa.pass('[20.4] renewal extends the household after transfer / leave / removal / account deletion');
end $$;

-- [20.5] 降级不覆盖其他有效订阅；Google RTDN 同样按覆盖范围重算
do $$
declare
  v_hid uuid;
  v_b uuid;
  v_sub_b uuid;
  v_b_until timestamptz := date_trunc('second', now() + interval '25 days');
begin
  perform qa.sub_setup('two');
  v_hid := qa.get('two_hid')::uuid;
  v_b := qa.get('two_b')::uuid;
  -- B 另外买了一份覆盖 H 的订阅（直接写表，模拟已登记）。
  insert into public.subscriptions (household_id, original_transaction_id, plan, expires_at, status, environment, owner_user_id, owner_app_account_token)
  values (null, 'otx-two-b', 'yearly', v_b_until, 'active', 'Sandbox', v_b, v_b)
  returning id into v_sub_b;
  insert into public.subscription_households (subscription_id, household_id) values (v_sub_b, v_hid);

  perform public.sync_subscription_by_transaction('otx-two', 'monthly', now() - interval '1 day', 'expired', 'tx-x');
  perform qa.check(public.effective_plan(v_hid) = 'yearly', 'A expired but B still covers H → stays Plus (yearly)');
  perform qa.check((select plus_until from public.households where id = v_hid) = v_b_until, 'plus_until comes from B');
  perform qa.check((select plus_owner_id from public.households where id = v_hid) = qa.member_id(v_hid, v_b),
                   'plus_owner_id is the remaining payer');

  perform public.sync_subscription_by_transaction('otx-two-b', 'yearly', now() - interval '1 day', 'revoked', 'tx-y');
  perform qa.check(public.effective_plan(v_hid) = 'free', 'both gone → Free');
  perform qa.check((select plus_until from public.households where id = v_hid) is null, 'plus_until cleared');

  -- Google：转让后 RTDN active 也会延长。
  perform qa.sub_setup('gp');
  update public.subscriptions set environment = 'Google' where original_transaction_id = 'otx-gp';
  perform qa.ok(qa.call(qa.get('gp_a')::uuid, format('select public.transfer_coordinator(%L)::text', qa.get('gp_mb'))), 'gp transfer');
  perform public.sync_subscription_state('otx-gp', 'active', 'monthly', date_trunc('second', now() + interval '33 days'));
  perform qa.check((select plus_until from public.households where id = qa.get('gp_hid')::uuid)
                     = date_trunc('second', now() + interval '33 days'), 'Google RTDN extends after transfer');
  perform public.sync_subscription_state('otx-gp', 'expired', 'monthly', now());
  perform qa.check(public.effective_plan(qa.get('gp_hid')::uuid) = 'free', 'Google expiry downgrades when nothing else covers');
  perform qa.pass('[20.5] expiry of one subscription never clears another active one; Google path covered');
end $$;

-- [20.6] get_my_subscription_status 只返回调用者本人的订阅（被移除后仍能查到）
do $$
declare
  v_a uuid;
  v_b uuid;
  v_hid uuid;
  r qa.result;
begin
  perform qa.sub_setup('st');
  v_a := qa.get('st_a')::uuid;
  v_b := qa.get('st_b')::uuid;
  v_hid := qa.get('st_hid')::uuid;
  r := qa.call(v_a, format('select row_to_json(s)::text from public.get_my_subscription_status(%L) s', v_hid));
  perform qa.check((qa.ok(r, 'payer status')::jsonb ->> 'is_paying')::boolean, 'payer sees is_paying=true');
  perform qa.check((r.value::jsonb ->> 'plan') = 'monthly', 'payer sees the plan');
  r := qa.call(v_b, format('select row_to_json(s)::text from public.get_my_subscription_status(%L) s', v_hid));
  perform qa.check(not (qa.ok(r, 'member status')::jsonb ->> 'is_paying')::boolean, 'other member sees is_paying=false');
  perform qa.check((r.value::jsonb ->> 'expires_at') is null, 'other member sees no expiry');

  perform qa.ok(qa.call(v_a, format('select public.transfer_coordinator(%L)::text', qa.get('st_mb'))), 'st transfer');
  perform qa.ok(qa.call(v_b, format('select public.remove_member(%L)::text', qa.member_id(v_hid, v_a))), 'st remove');
  r := qa.call(v_a, format('select row_to_json(s)::text from public.get_my_subscription_status(%L) s', v_hid));
  perform qa.check((qa.ok(r, 'removed payer status')::jsonb ->> 'is_paying')::boolean,
                   'removed payer still sees is_paying=true (for the "still charging" warning)');
  r := qa.call(qa.user('anonymous'), format('select row_to_json(s)::text from public.get_my_subscription_status(%L) s', v_hid));
  perform qa.check(not (qa.ok(r, 'stranger status')::jsonb ->> 'is_paying')::boolean, 'stranger sees false');
  perform qa.denied(qa.call(null, format('select public.get_my_subscription_status(%L)::text', v_hid), 'anon'),
                    'anon cannot call get_my_subscription_status');
  perform qa.pass('[20.6] get_my_subscription_status only reports the caller''s own subscription');
end $$;

-- [20.7] 冲突辅助函数：apple_identity_owner / account_has_data / delete_auth_user_if_empty
do $$
declare
  v_x uuid;
  v_hid uuid;
  v_sub uuid;
begin
  -- apple_identity_owner
  v_x := qa.user('apple');
  perform qa.check(public.apple_identity_owner('apple.' || v_x::text) = v_x, 'apple_identity_owner finds the uid');
  perform qa.check(public.apple_identity_owner('apple.unknown') is null, 'unknown sub → null');

  -- account_has_data：members / owner_user_id / owner_app_account_token
  perform qa.check(public.account_has_data(v_x) = false, 'empty apple account has no data');
  v_hid := qa.household(qa.user('apple'), 'Data home');
  perform qa.add_member(v_hid, v_x);
  perform qa.check(public.account_has_data(v_x) = true, 'a member row is data');

  v_x := qa.user('apple');
  insert into public.subscriptions (original_transaction_id, plan, expires_at, status, owner_user_id)
  values ('otx-owner-' || v_x, 'monthly', now() + interval '1 day', 'active', v_x);
  perform qa.check(public.account_has_data(v_x) = true, 'owner_user_id is data');

  v_x := qa.user('apple');
  insert into public.subscriptions (original_transaction_id, plan, expires_at, status, owner_user_id, owner_app_account_token)
  values ('otx-token-' || v_x, 'monthly', now() - interval '1 day', 'expired', null, v_x);
  perform qa.check(public.account_has_data(v_x) = true, 'owner_app_account_token alone is data');

  -- delete_auth_user_if_empty
  v_x := qa.user('apple');
  perform qa.check(public.delete_auth_user_if_empty(v_x) = true, 'empty apple-only account is deleted');
  perform qa.check(not exists (select 1 from auth.users where id = v_x), 'auth user gone');

  v_x := qa.user('apple');
  perform qa.add_member(v_hid, v_x);
  perform qa.check(public.delete_auth_user_if_empty(v_x) = false, 'account with a member row is kept');
  perform qa.check(exists (select 1 from auth.users where id = v_x), 'kept');

  v_x := qa.user('apple');
  insert into public.subscriptions (original_transaction_id, plan, expires_at, status, owner_app_account_token)
  values ('otx-keep-' || v_x, 'monthly', now() + interval '1 day', 'active', v_x);
  perform qa.check(public.delete_auth_user_if_empty(v_x) = false, 'account owning a subscription token is kept');

  v_x := qa.user('apple');
  insert into auth.identities (provider_id, user_id, identity_data, provider)
  values (v_x::text, v_x, jsonb_build_object('sub', v_x::text, 'email', 'x@qa.invalid'), 'email');
  perform qa.check(public.delete_auth_user_if_empty(v_x) = false, 'account with an email identity is kept');

  v_x := qa.user('apple');
  update auth.users set encrypted_password = 'qa-placeholder-not-a-real-hash' where id = v_x;
  perform qa.check(public.delete_auth_user_if_empty(v_x) = false, 'account with a password is kept');

  v_x := qa.user('anonymous');
  perform qa.check(public.delete_auth_user_if_empty(v_x) = false, 'account without an apple identity is kept');
  perform qa.check(public.delete_auth_user_if_empty(gen_random_uuid()) = false, 'unknown uid → false');
  perform qa.check(public.delete_auth_user_if_empty(null) = false, 'null → false');

  -- 权限：只给 service_role
  v_x := qa.user('apple');
  perform qa.denied(qa.call(v_x, format('select public.apple_identity_owner(%L)::text', 'apple.' || v_x)), 'authenticated: apple_identity_owner');
  perform qa.denied(qa.call(v_x, format('select public.account_has_data(%L)::text', v_x)), 'authenticated: account_has_data');
  perform qa.denied(qa.call(v_x, format('select public.delete_auth_user_if_empty(%L)::text', v_x)), 'authenticated: delete_auth_user_if_empty');
  perform qa.denied(qa.call(null, format('select public.delete_auth_user_if_empty(%L)::text', v_x), 'anon'), 'anon: delete_auth_user_if_empty');
  perform qa.check(qa.ok(qa.call(null, format('select public.delete_auth_user_if_empty(%L)::text', v_x), 'service_role'),
                         'service_role can call delete_auth_user_if_empty') = 'true', 'service_role deletes the empty account');
  perform qa.pass('[20.7] conflict helpers only delete empty Apple-only accounts and are service_role only');
end $$;

-- [20.8] 数据库角色没有 auth.users 的 DELETE / 行锁权限时：返回 NULL（交给 Admin API），什么都不删
begin;
create role qa_limited_owner nologin;
grant usage on schema auth, public to qa_limited_owner;
grant select on auth.users, auth.identities to qa_limited_owner;
grant execute on function public.account_has_data(uuid) to qa_limited_owner;
alter function public.delete_auth_user_if_empty(uuid) owner to qa_limited_owner;
do $$
declare
  v_x uuid := qa.user('apple');
  v_kept uuid := qa.user('apple');
  v_hid uuid := qa.household(qa.user('apple'), 'Limited home');
begin
  perform qa.add_member(v_hid, v_kept);
  perform qa.check(public.delete_auth_user_if_empty(v_x) is null, 'empty account but no DELETE privilege → NULL');
  perform qa.check(exists (select 1 from auth.users where id = v_x), 'nothing deleted by SQL');
  perform qa.check(public.delete_auth_user_if_empty(v_kept) = false, 'non-empty account still → false');
  perform qa.pass('[20.8] without DELETE on auth.users the helper returns NULL so the caller uses admin.deleteUser');
end $$;
rollback;

drop function if exists qa.sub_setup(text);
drop function if exists qa.sub_renew_extends(text);

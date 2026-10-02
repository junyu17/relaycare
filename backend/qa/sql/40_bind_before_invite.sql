-- ============================================================================
-- 0060 绑定后才能邀请：本地回归测试（只在加载了 pending_migrations 的库里运行）
-- ============================================================================

-- [40.1] 匿名协调人：生成码报 account_binding_required；读码返回空（即使已有 1.9 时生成的有效码）
do $$
declare
  v_coord uuid := qa.user('anonymous');
  v_hid uuid := qa.household(v_coord, 'Anon home');
  v_old_code text := qa.code_for(v_hid);       -- 模拟 0060 之前（1.9）生成的码
  r qa.result;
begin
  r := qa.call(v_coord, 'select code from public.generate_household_code()');
  perform qa.err(r, 'account_binding_required', 'anonymous coordinator cannot generate a code',
                 'To invite family, update TaskKin and sign in with Apple.');
  perform qa.check((select count(*) from public.household_codes where household_id = v_hid and status = 'active') = 1,
                   'refused generation does not lock the existing code');
  r := qa.call(v_coord, 'select count(*)::text from public.get_household_code()');
  perform qa.check(qa.ok(r, 'get_household_code does not raise') = '0', 'unbound coordinator reads no code');
  perform qa.set('b_coord', v_coord::text);
  perform qa.set('b_hid', v_hid::text);
  perform qa.set('b_old_code', v_old_code);
  perform qa.pass('[40.1] unbound coordinator: generate → account_binding_required, get → empty');
end $$;

-- [40.2] 绑定后（linkIdentity 挂上 apple identity）两者都正常
insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
select 'apple.' || qa.get('b_coord'), qa.get('b_coord')::uuid,
       jsonb_build_object('sub', 'apple.' || qa.get('b_coord')), 'apple', now(), now();
do $$
declare
  v_coord uuid := qa.get('b_coord')::uuid;
  v_code text;
  r qa.result;
begin
  r := qa.call(v_coord, 'select code from public.get_household_code()');
  perform qa.check(qa.ok(r, 'bound coordinator reads the code') = qa.get('b_old_code'), 'the existing code is visible after binding');
  v_code := qa.ok(qa.call(v_coord, 'select code from public.generate_household_code()'), 'bound coordinator generates');
  perform qa.check(v_code ~ '^[0-9]{6}$', '6-digit code');
  perform qa.check(qa.ok(qa.call(v_coord, 'select code from public.get_household_code()'), 'read new') = v_code,
                   'get returns the new code');
  perform qa.pass('[40.2] after binding Apple both generate and get work (is_anonymous may still be true)');
end $$;

-- [40.3] 老的邮箱 + 密码协调人不受影响；PUT /user 只设邮箱的匿名协调人仍被拦
do $$
declare
  v_email uuid := qa.user('email_password');
  v_email_hid uuid := qa.household(v_email, 'Email home');
  v_half uuid := qa.user('email_no_password');
  v_half_hid uuid := qa.household(v_half, 'Half home');
begin
  perform qa.check(qa.ok(qa.call(v_email, 'select code from public.generate_household_code()'), 'email coordinator')
                   ~ '^[0-9]{6}$', 'email + password coordinator generates a code');
  perform qa.err(qa.call(v_half, 'select code from public.generate_household_code()'),
                 'account_binding_required', 'email without password is not bound');
  perform qa.pass('[40.3] email+password coordinators unaffected; email-only upgrade cannot bypass binding');
end $$;

-- [40.4] 旧邀请入口对客户端 revoke
do $$
declare
  v_coord uuid := qa.user('apple');
  v_hid uuid := qa.household(v_coord, 'Invite home');
  v_mid uuid;
begin
  v_mid := qa.member_id(v_hid, v_coord);
  perform qa.denied(qa.call(v_coord, format('select public.invite_member(%L, %L)::text', v_hid, 'caregiver')),
                    'authenticated cannot call invite_member');
  perform qa.denied(qa.call(v_coord, format('select public.create_invite(%L)::text', v_mid)),
                    'authenticated cannot call create_invite');
  perform qa.denied(qa.call(null, format('select public.invite_member(%L, %L)::text', v_hid, 'caregiver'), 'anon'),
                    'anon cannot call invite_member');
  perform qa.pass('[40.4] invite_member / create_invite revoked from API roles');
end $$;

-- [40.5] update_member_role：提升未绑定成员为协调人被拒；已绑定可以；降级不受影响
do $$
declare
  v_coord uuid := qa.user('apple');
  v_anon uuid := qa.user('anonymous');
  v_bound uuid := qa.user('apple');
  v_hid uuid := qa.household(v_coord, 'Role home');
  v_m_anon uuid;
  v_m_bound uuid;
begin
  v_m_anon := qa.add_member(v_hid, v_anon, 'caregiver', 'Ann');
  v_m_bound := qa.add_member(v_hid, v_bound, 'caregiver', 'Bo');
  perform qa.err(qa.call(v_coord, format('select public.update_member_role(%L, %L)::text', v_m_anon, 'coordinator')),
                 'target_not_bound', 'cannot promote an unbound member', 'The new coordinator must sign in with Apple first.');
  perform qa.check((select role from public.members where id = v_m_anon) = 'caregiver', 'role unchanged');
  perform qa.ok(qa.call(v_coord, format('select public.update_member_role(%L, %L)::text', v_m_anon, 'viewer')),
                'unbound member can still be changed to viewer');
  perform qa.ok(qa.call(v_coord, format('select public.update_member_role(%L, %L)::text', v_m_bound, 'coordinator')),
                'bound member can be promoted');
  perform qa.check((select role from public.members where id = v_m_bound) = 'coordinator', 'promoted');
  perform qa.err(qa.call(v_anon, format('select public.update_member_role(%L, %L)::text', v_m_anon, 'coordinator')),
                 'coordinator_required', 'viewer cannot change roles');
  perform qa.pass('[40.5] update_member_role refuses to promote an unbound member');
end $$;

-- [40.6] 决策 4A：1.9 匿名协调人把协调人转让给已绑定的家人后，新协调人可以邀请
do $$
declare
  v_anon_coord uuid := qa.user('anonymous');
  v_bound uuid := qa.user('apple');
  v_hid uuid := qa.household(v_anon_coord, 'Legacy home');
  v_mb uuid;
begin
  v_mb := qa.add_member(v_hid, v_bound, 'caregiver', 'Kim');
  perform qa.err(qa.call(v_anon_coord, 'select code from public.generate_household_code()'),
                 'account_binding_required', 'legacy anonymous coordinator gets no exemption');
  perform qa.ok(qa.call(v_anon_coord, format('select public.transfer_coordinator(%L)::text', v_mb)),
                'anonymous coordinator transfers to a bound member');
  perform qa.check(qa.ok(qa.call(v_bound, 'select code from public.generate_household_code()'), 'new coordinator')
                   ~ '^[0-9]{6}$', 'new (bound) coordinator generates a code');
  perform qa.pass('[40.6] 4A: no exemption; transfer to a bound member is the recovery path');
end $$;

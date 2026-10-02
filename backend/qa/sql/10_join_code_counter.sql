-- ============================================================================
-- 0057 防猜码计数修复：本地回归测试（backend/qa/local_pg.sh 调用）
-- 每个 DO 块是一个独立事务；跨事务断言（计数是否真的提交）通过 qa.vars 传 id。
-- ============================================================================

select qa.reset_join_guards();

-- [10.1] 码不存在：返回 NULL、不报错；计数在「下一个事务」里仍然可见（回滚问题的回归测试）
do $$
declare
  v_guesser uuid := qa.user('anonymous');
  r qa.result;
begin
  r := qa.call(v_guesser, format('select public.join_by_code(%L, %L)::text', qa.unused_code(), 'Guesser'));
  perform qa.check(r.ok, 'wrong code must not raise (got ' || coalesce(r.message, '') || ')');
  perform qa.check(r.value is null, 'wrong code returns NULL');
  perform qa.set('guesser', v_guesser::text);
end $$;

do $$
declare
  v_guesser uuid := qa.get('guesser')::uuid;
begin
  perform qa.check(
    (select attempts from public.join_attempts where user_id = v_guesser) = 1,
    'join_attempts.attempts = 1 committed after a wrong code'
  );
  perform qa.check(
    (select sum(failures) from public.join_failure_windows) = 1,
    'join_failure_windows total = 1 committed after a wrong code'
  );
  perform qa.pass('[10.1] wrong code returns NULL and both counters commit');
end $$;

-- [10.2] 第 2–5 次返回 NULL，第 6 次报原英文限流文案 + hint join_rate_limited，且不再计数
do $$
declare
  v_guesser uuid := qa.get('guesser')::uuid;
  r qa.result;
  i int;
begin
  for i in 2..5 loop
    r := qa.call(v_guesser, format('select public.join_by_code(%L)::text', qa.unused_code()));
    perform qa.check(r.ok and r.value is null, 'attempt ' || i || ' returns NULL');
  end loop;
  r := qa.call(v_guesser, format('select public.join_by_code(%L)::text', qa.unused_code()));
  perform qa.err(r, 'join_rate_limited', '6th attempt is rate limited',
                 'Too many join attempts. Please wait a few minutes and try again.');
end $$;

do $$
declare
  v_guesser uuid := qa.get('guesser')::uuid;
begin
  perform qa.check((select attempts from public.join_attempts where user_id = v_guesser) = 5, 'attempts stay at 5');
  perform qa.check((select sum(failures) from public.join_failure_windows) = 5, 'global failures = 5');
  perform qa.pass('[10.2] 6th attempt raises join_rate_limited with the original English message');
end $$;

-- [10.3] 过期码：仍报原英文 + hint join_code_expired
do $$
declare
  v_coord uuid := qa.user('apple');
  v_joiner uuid := qa.user('anonymous');
  v_hid uuid := qa.household(v_coord);
  v_code text := qa.code_for(v_hid, interval '-1 minute');
  r qa.result;
begin
  r := qa.call(v_joiner, format('select public.join_by_code(%L, %L)::text', v_code, 'Late'));
  perform qa.err(r, 'join_code_expired', 'expired code', 'Code has expired. Ask the coordinator for a new one.');
  perform qa.check(
    not exists (select 1 from public.members where household_id = v_hid and user_id = v_joiner),
    'expired code does not create a member'
  );
  perform qa.pass('[10.3] expired code keeps the original English error (hint join_code_expired)');
end $$;

-- [10.4] 成功加入后 uid 计数清零；格式错误与未登录带 hint
do $$
declare
  v_coord uuid := qa.user('apple');
  v_joiner uuid := qa.user('anonymous');
  v_hid uuid := qa.household(v_coord);
  v_code text := qa.code_for(v_hid);
  r qa.result;
begin
  r := qa.call(v_joiner, format('select public.join_by_code(%L)::text', qa.unused_code()));
  r := qa.call(v_joiner, format('select public.join_by_code(%L)::text', qa.unused_code()));
  perform qa.check((select attempts from public.join_attempts where user_id = v_joiner) = 2, 'two failed attempts counted');

  r := qa.call(v_joiner, format('select public.join_by_code(%L, %L)::text', v_code, 'Sam'));
  perform qa.check(qa.ok(r, 'valid code joins')::uuid = v_hid, 'join_by_code returns the household id');
  perform qa.check(
    exists (select 1 from public.members where household_id = v_hid and user_id = v_joiner
            and role = 'caregiver' and invite_status = 'active'),
    'joiner is an active caregiver'
  );
  perform qa.check((select attempts from public.join_attempts where user_id = v_joiner) = 0, 'attempts reset to 0 on success');

  r := qa.call(v_joiner, format('select public.join_by_code(%L)::text', v_code));
  perform qa.err(r, 'join_already_member', 'second join is rejected', 'You are already a member of this household');

  r := qa.call(v_joiner, $q$select public.join_by_code('12345')::text$q$);
  perform qa.err(r, 'join_code_format', 'five digits rejected', 'Code must be 6 digits');
  r := qa.call(null, format('select public.join_by_code(%L)::text', v_code));
  perform qa.err(r, 'not_authenticated', 'no uid rejected', 'Not authenticated');
  perform qa.pass('[10.4] success resets the uid counter; format/auth errors carry hints');
end $$;

-- [10.5] generate_household_code 使用 CSPRNG，出 6 位数字码
do $$
declare
  v_def text := pg_get_functiondef('public.generate_household_code()'::regprocedure);
  v_coord uuid := qa.user('apple');
  v_hid uuid := qa.household(v_coord);
  r qa.result;
  i int;
begin
  perform qa.check(position('random()' in v_def) = 0, 'generate_household_code no longer calls random()');
  perform qa.check(position('gen_random_uuid()' in v_def) > 0, 'generate_household_code derives from gen_random_uuid()');
  for i in 1..40 loop
    r := qa.call(v_coord, 'select code from public.generate_household_code()');
    perform qa.check(qa.ok(r, 'coordinator generates a code') ~ '^[0-9]{6}$', 'code is 6 digits: ' || coalesce(r.value, 'null'));
  end loop;
  perform qa.check(
    (select count(*) from public.household_codes where household_id = v_hid and status = 'active') = 1,
    'only one active code per household'
  );
  perform qa.pass('[10.5] codes come from gen_random_uuid(), 6 digits, one active code');
end $$;

-- [10.6] 1.9 兼容：0060 之前匿名协调人仍能出码（0060 上线后由 40_bind_before_invite.sql 覆盖）
do $$
declare
  v_coord uuid := qa.user('anonymous');
  v_hid uuid := qa.household(v_coord);
  r qa.result;
begin
  if position('account_binding_required' in pg_get_functiondef('public.generate_household_code()'::regprocedure)) > 0 then
    raise notice 'SKIP [10.6] 0060 is applied in this database; covered by 40_bind_before_invite.sql';
    return;
  end if;
  r := qa.call(v_coord, 'select code from public.generate_household_code()');
  perform qa.check(qa.ok(r, 'anonymous coordinator generates a code before 0060') ~ '^[0-9]{6}$', '6 digits');
  perform qa.pass('[10.6] before 0060 an anonymous (1.9) coordinator can still generate a code');
end $$;

-- [10.7] 全站熔断：30 个不同 uid 各输错 1 次 → 熔断；旧 RPC 对有效码也报 join_rate_limited
select qa.reset_join_guards();
do $$
declare
  r qa.result;
  i int;
begin
  for i in 1..29 loop
    r := qa.call(qa.user('anonymous'), format('select public.join_by_code(%L)::text', qa.unused_code()));
    perform qa.check(r.ok and r.value is null, 'failure ' || i || ' returns NULL');
  end loop;
  perform qa.check(not public.join_breaker_tripped(), 'breaker not tripped at 29 failures');
  r := qa.call(qa.user('anonymous'), format('select public.join_by_code(%L)::text', qa.unused_code()));
  perform qa.check(r.ok and r.value is null, 'failure 30 returns NULL');
end $$;

do $$
declare
  v_coord uuid := qa.user('apple');
  v_joiner uuid := qa.user('anonymous');
  v_hid uuid := qa.household(v_coord);
  v_code text := qa.code_for(v_hid);
  r qa.result;
begin
  perform qa.check(public.join_breaker_tripped(), 'breaker tripped after 30 failures in 15 minutes');
  perform qa.check((select trips from public.join_breaker where id = 1) = 1, 'trips = 1');
  perform qa.check(
    (select tripped_until from public.join_breaker where id = 1) > now() + interval '29 minutes',
    'tripped for 30 minutes'
  );
  r := qa.call(v_joiner, format('select public.join_by_code(%L)::text', v_code));
  perform qa.err(r, 'join_rate_limited', 'old RPC refuses while tripped',
                 'Too many join attempts. Please wait a few minutes and try again.');
  perform qa.check(
    not exists (select 1 from public.members where household_id = v_hid and user_id = v_joiner),
    'no member while tripped'
  );
  perform qa.check(
    (select attempts from public.join_attempts where user_id = v_joiner) is null,
    'a refused call writes nothing'
  );
  perform qa.set('breaker_hid', v_hid::text);
  perform qa.set('breaker_code', v_code);
  perform qa.set('breaker_joiner', v_joiner::text);
  perform qa.pass('[10.7] 30 failures from 30 uids trip the breaker; join_by_code refuses with join_rate_limited');
end $$;

-- [10.8] 30 分钟后自动恢复：把时间桶和熔断时间都挪到 31 分钟以前
update public.join_failure_windows set bucket_start = bucket_start - interval '35 minutes';
update public.join_breaker set tripped_until = now() - interval '1 second' where id = 1;
do $$
declare
  r qa.result;
begin
  perform qa.check(not public.join_breaker_tripped(), 'breaker released after 30 minutes');
  r := qa.call(qa.get('breaker_joiner')::uuid, format('select public.join_by_code(%L)::text', qa.get('breaker_code')));
  perform qa.check(qa.ok(r, 'join works again')::uuid = qa.get('breaker_hid')::uuid, 'joined after recovery');
  r := qa.call(qa.user('anonymous'), format('select public.join_by_code(%L)::text', qa.unused_code()));
  perform qa.check(not public.join_breaker_tripped(), 'one new failure does not re-trip (old buckets are outside 15 minutes)');
  perform qa.pass('[10.8] breaker releases after 30 minutes and old buckets no longer count');
end $$;

-- [10.9] 权限：内部函数与计数表对客户端不可见；匿名 API 角色不能调 join_by_code
do $$
declare
  v_uid uuid := qa.user('anonymous');
begin
  perform qa.denied(qa.call(v_uid, 'select public.join_record_failure()::text'), 'authenticated cannot call join_record_failure');
  perform qa.denied(qa.call(v_uid, 'select public.join_breaker_tripped()::text'), 'authenticated cannot call join_breaker_tripped');
  perform qa.denied(qa.call(v_uid, 'select count(*)::text from public.join_breaker'), 'authenticated cannot read join_breaker');
  perform qa.denied(qa.call(v_uid, 'select count(*)::text from public.join_failure_windows'), 'authenticated cannot read join_failure_windows');
  perform qa.denied(qa.call(null, $q$select public.join_by_code('123456')::text$q$, 'anon'), 'anon cannot call join_by_code');
  perform qa.check(
    (select string_agg(column_name, ',' order by column_name) from information_schema.columns
      where table_schema = 'public' and table_name = 'join_failure_windows') = 'bucket_start,failures',
    'join_failure_windows only stores time buckets and counts'
  );
  perform qa.check(
    (select string_agg(column_name, ',' order by column_name) from information_schema.columns
      where table_schema = 'public' and table_name = 'join_breaker') = 'id,last_tripped_at,tripped_until,trips',
    'join_breaker only stores breaker state'
  );
  perform qa.pass('[10.9] internals are not exposed to API roles; no IP or uid is stored');
end $$;

select qa.reset_join_guards();

-- [10.10] 0057 第 7 条：订阅伪造口子。anon / authenticated 不能调 upsert_subscription（0011 只 revoke 了 PUBLIC，
--         Supabase 默认权限显式授予过 API 角色）；会写订阅或 Plus 权益的 SECURITY DEFINER 函数里，
--         API 角色只能执行 create_household（它只挂调用者 auth.uid() 自己名下的有效订阅）。
do $$
declare
  v_coord uuid := qa.user('apple');
  v_hid uuid := qa.household(v_coord, 'Forgery home');
  v_forge text;
  v_writers text := '(insert\s+into\s+(public\.)?(subscriptions|subscription_households)|'
    || 'update\s+(public\.)?(subscriptions|subscription_households)|'
    || 'delete\s+from\s+(public\.)?(subscriptions|subscription_households)|'
    || 'set_household_plus|refresh_household_plus|plus_plan\s*=|plus_until\s*=)';
  v_exposed text;
begin
  v_forge := format(
    'select public.upsert_subscription(%L, %L, %L, now() + interval %L, %L, %L, %L, null)::text',
    v_hid, 'forged-tx-1', 'yearly', '5 years', 'active', 'Production', 'forged'
  );
  perform qa.denied(qa.call(null, v_forge, 'anon'), 'anon cannot call upsert_subscription');
  perform qa.denied(qa.call(v_coord, v_forge), 'authenticated cannot call upsert_subscription');
  perform qa.check((select plus_plan from public.households where id = v_hid) = 'free', 'household is still on Free');
  perform qa.check(not exists (select 1 from public.subscriptions where original_transaction_id = 'forged-tx-1'),
                   'no forged subscription row');
  -- 正向对照：service_role（Edge Function）仍能执行；扫描用的正则确实能匹配到 upsert_subscription。
  perform qa.check(has_function_privilege('service_role',
                     'public.upsert_subscription(uuid,text,text,timestamptz,text,text,text,uuid)', 'execute'),
                   'service_role keeps execute');
  perform qa.check(exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                           where n.nspname = 'public' and p.proname = 'upsert_subscription' and p.prosrc ~* v_writers),
                   'scan regex matches upsert_subscription (positive control)');

  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into v_exposed
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.prosrc ~* v_writers
      and p.proname <> 'create_household'
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  perform qa.check(v_exposed is null, 'subscription / Plus writers executable by API roles: ' || coalesce(v_exposed, ''));
  perform qa.pass('[10.10] upsert_subscription is service_role only; no API role can write subscriptions or Plus');
end $$;

-- ============================================================================
-- 0059 加入申请 + join_by_code_v2：本地回归测试（决策 2B）
-- ============================================================================

select qa.reset_join_guards();

-- [30.1] 不熔断：v2 直接加入；码不存在 / 已过期都返回 invalid 并计入失败；第 6 次 rate_limited
do $$
declare
  v_coord uuid := qa.user('apple');
  v_joiner uuid := qa.user('anonymous');
  v_guesser uuid := qa.user('anonymous');
  v_hid uuid := qa.household(v_coord, 'V2 home');
  v_code text := qa.code_for(v_hid);
  v_expired_hid uuid := qa.household(qa.user('apple'), 'Expired home');
  v_expired text := qa.code_for(v_expired_hid, interval '-1 minute');
  v jsonb;
  i int;
begin
  v := qa.ok(qa.call(v_joiner, format('select public.join_by_code_v2(%L, %L)::text', v_code, 'Jo')), 'v2 join')::jsonb;
  perform qa.check(v ->> 'status' = 'joined', 'status joined, got ' || v::text);
  perform qa.check((v ->> 'household_id')::uuid = v_hid, 'household_id returned');
  perform qa.check(exists (select 1 from public.members where household_id = v_hid and user_id = v_joiner
                           and role = 'caregiver' and invite_status = 'active'), 'joiner is an active caregiver');
  perform qa.check(exists (select 1 from public.role_notifications where household_id = v_hid
                           and title_key = 'notification.title.memberJoined'), 'coordinator notified');
  perform qa.check((select attempts from public.join_attempts where user_id = v_joiner) = 0, 'counter reset on join');

  v := qa.ok(qa.call(v_guesser, format('select public.join_by_code_v2(%L)::text', qa.unused_code())), 'v2 unknown')::jsonb;
  perform qa.check(v ->> 'status' = 'invalid', 'unknown code → invalid');
  v := qa.ok(qa.call(v_guesser, format('select public.join_by_code_v2(%L)::text', v_expired)), 'v2 expired')::jsonb;
  perform qa.check(v ->> 'status' = 'invalid', 'expired code → invalid (not distinguished)');
  perform qa.check(v ? 'household_id' = false, 'invalid never reveals a household');
  perform qa.check((select status from public.household_codes where code = v_expired and household_id = v_expired_hid) = 'locked',
                   'expired code is locked');
  perform qa.check((select attempts from public.join_attempts where user_id = v_guesser) = 2, 'both failures counted per uid');
  perform qa.check((select sum(failures) from public.join_failure_windows) = 2, 'both failures counted globally');
  for i in 3..5 loop
    v := qa.ok(qa.call(v_guesser, format('select public.join_by_code_v2(%L)::text', qa.unused_code())), 'v2 guess')::jsonb;
    perform qa.check(v ->> 'status' = 'invalid', 'guess ' || i || ' invalid');
  end loop;
  v := qa.ok(qa.call(v_guesser, format('select public.join_by_code_v2(%L)::text', v_code)), 'v2 6th')::jsonb;
  perform qa.check(v ->> 'status' = 'rate_limited', '6th attempt rate_limited even with a valid code');
  perform qa.check(not exists (select 1 from public.members where household_id = v_hid and user_id = v_guesser),
                   'rate-limited caller did not join');
  perform qa.err(qa.call(v_joiner, format('select public.join_by_code_v2(%L)::text', v_code)),
                 'join_already_member', 'already a member');
  perform qa.err(qa.call(v_joiner, $q$select public.join_by_code_v2('12a456')::text$q$), 'join_code_format', 'format');
  perform qa.denied(qa.call(null, $q$select public.join_by_code_v2('123456')::text$q$, 'anon'), 'anon cannot call v2');
  perform qa.pass('[30.1] v2 joins instantly when not tripped; invalid/expired → invalid and counted; rate_limited');
end $$;

select qa.reset_join_guards();

-- [30.2] 熔断中：有效码 → pending；不写 members；申请人看不到任何家庭数据和家庭名
do $$
declare
  v_coord uuid := qa.user('apple');
  v_care uuid := qa.user('apple');
  v_req uuid := qa.user('anonymous');
  v_hid uuid := qa.household(v_coord, 'Secret home');
  v_code text := qa.code_for(v_hid);
  v_mc uuid;
  v jsonb;
  r qa.result;
begin
  v_mc := qa.member_id(v_hid, v_coord);
  perform qa.add_member(v_hid, v_care, 'caregiver', 'Cara');
  insert into public.tasks (household_id, title, requested_by_id) values (v_hid, 'Pick up meds', v_mc);
  insert into public.documents (household_id, name, uploaded_by_id, source) values (v_hid, 'lab.pdf', v_mc, 'manual_upload');
  update public.join_breaker set tripped_until = now() + interval '30 minutes', trips = 1 where id = 1;

  v := qa.ok(qa.call(v_req, format('select public.join_by_code_v2(%L, %L)::text', v_code, 'Ray')), 'v2 while tripped')::jsonb;
  perform qa.check(v ->> 'status' = 'pending', 'status pending, got ' || v::text);
  perform qa.check(v ? 'household_id' = false, 'pending does not return household_id');
  perform qa.check(not exists (select 1 from public.members where user_id = v_req), 'no members row while pending');
  perform qa.check((select attempts from public.join_attempts where user_id = v_req) = 1,
                   'filing a request does not reset the per-uid counter');
  perform qa.check(
    exists (select 1 from public.role_notifications where household_id = v_hid and audience = 'coordinator'
            and title_key = 'notification.title.joinRequested' and entity_id = v ->> 'request_id'),
    'coordinator notified of the request'
  );

  -- 正向对照：协调人能看到这户的任务和文档（下面的 0 行不是查询本身失效）
  perform qa.check(qa.ok(qa.call(v_coord, 'select count(*)::text from public.tasks'), 'coord tasks') = '1', 'coordinator sees 1 task');
  perform qa.check(qa.ok(qa.call(v_coord, 'select count(*)::text from public.documents'), 'coord docs') = '1', 'coordinator sees 1 document');
  -- 申请人什么都看不到
  perform qa.check(qa.ok(qa.call(v_req, 'select count(*)::text from public.tasks'), 'tasks') = '0', 'requester sees 0 tasks');
  perform qa.check(qa.ok(qa.call(v_req, 'select count(*)::text from public.documents'), 'docs') = '0', 'requester sees 0 documents');
  perform qa.check(qa.ok(qa.call(v_req, 'select count(*)::text from public.households'), 'hh') = '0', 'requester sees 0 households');
  perform qa.check(qa.ok(qa.call(v_req, 'select count(*)::text from public.members'), 'members') = '0', 'requester sees 0 members');
  r := qa.call(v_req, 'select json_agg(m)::text from public.my_join_requests() m');
  perform qa.check((qa.ok(r, 'my_join_requests')::jsonb -> 0 ->> 'status') = 'pending', 'my_join_requests shows pending');
  perform qa.check((r.value::jsonb -> 0 ->> 'household_name') is null, 'no household name while pending');
  perform qa.check((r.value::jsonb -> 0 ->> 'household_id') is null, 'no household id while pending');

  -- 谁能直接读申请表（RLS）：只有该户协调人。申请人自己也不能直接读（表里有 household_id / decided_by，
  -- 直接读就绕过了 my_join_requests() 对家庭身份的隐藏）；同户 caregiver 也不能。
  perform qa.check(qa.ok(qa.call(v_req, 'select count(*)::text from public.household_join_requests'), 'own') = '0',
                   'requester cannot read the request table directly');
  perform qa.check(
    qa.ok(qa.call(v_req, $q$select coalesce(string_agg(household_id::text, ','), 'none') from public.household_join_requests$q$),
          'own household_id') = 'none',
    'requester gets no household_id from the table'
  );
  perform qa.check(qa.ok(qa.call(v_coord, 'select count(*)::text from public.household_join_requests'), 'coord') = '1',
                   'coordinator sees the household request');
  perform qa.check(qa.ok(qa.call(v_care, 'select count(*)::text from public.household_join_requests'), 'care') = '0',
                   'caregiver does not see requests');
  perform qa.denied(qa.call(v_req, format(
    'insert into public.household_join_requests (household_id, user_id, display_name) values (%L, %L, %L) returning id::text',
    v_hid, v_req, 'X')), 'no direct insert');
  perform qa.denied(qa.call(v_coord, format(
    'update public.household_join_requests set status = %L where household_id = %L returning id::text', 'approved', v_hid)),
    'no direct update');

  -- 同一个码再提交一次：已经有 pending，查码之前就返回 already_pending 和同一条申请
  r := qa.call(v_req, format('select public.join_by_code_v2(%L)::text', v_code));
  perform qa.check(qa.ok(r, 'v2 again')::jsonb ->> 'status' = 'already_pending', 'second submit → already_pending');
  perform qa.check(r.value::jsonb ->> 'request_id' = v ->> 'request_id', 'second submit points at the same request');
  perform qa.check((select attempts from public.join_attempts where user_id = v_req) = 2,
                   'the resubmit is counted, not reset');
  -- 旧 RPC 在熔断中照旧报错（1.9 协调人没有审批界面）
  perform qa.err(qa.call(qa.user('anonymous'), format('select public.join_by_code(%L)::text', v_code)),
                 'join_rate_limited', 'old join_by_code still refuses while tripped');

  perform qa.set('p_hid', v_hid::text);
  perform qa.set('p_coord', v_coord::text);
  perform qa.set('p_care', v_care::text);
  perform qa.set('p_req', v_req::text);
  perform qa.set('p_request', v ->> 'request_id');
  perform qa.set('p_code', v_code);
  perform qa.pass('[30.2] tripped: valid code → pending, no member row, requester sees nothing (no name)');
end $$;

-- [30.3] 同意：只有该户协调人；同意后成为 active 成员并通知协调人
do $$
declare
  v_hid uuid := qa.get('p_hid')::uuid;
  v_req uuid := qa.get('p_req')::uuid;
  v_request text := qa.get('p_request');
  r qa.result;
begin
  perform qa.err(qa.call(qa.get('p_care')::uuid, format('select public.approve_join_request(%L)::text', v_request)),
                 'coordinator_required', 'caregiver cannot approve');
  perform qa.err(qa.call(v_req, format('select public.approve_join_request(%L)::text', v_request)),
                 'coordinator_required', 'requester cannot approve');
  perform qa.err(qa.call(qa.get('p_coord')::uuid, format('select public.approve_join_request(%L)::text', gen_random_uuid())),
                 'join_request_not_found', 'unknown request');

  perform qa.check(qa.ok(qa.call(qa.get('p_coord')::uuid, format('select public.approve_join_request(%L)::text', v_request)),
                         'coordinator approves')::uuid = v_hid, 'approve returns the household');
  perform qa.check(exists (select 1 from public.members where household_id = v_hid and user_id = v_req
                           and role = 'caregiver' and invite_status = 'active' and name = 'Ray'),
                   'requester is now an active caregiver');
  perform qa.check((select status from public.household_join_requests where id = v_request::uuid) = 'approved', 'status approved');
  perform qa.check((select decided_by from public.household_join_requests where id = v_request::uuid)
                     = qa.member_id(v_hid, qa.get('p_coord')::uuid), 'decided_by = coordinator member');
  perform qa.check(exists (select 1 from public.role_notifications where household_id = v_hid
                           and title_key = 'notification.title.memberJoined' and values ->> 'name' = 'Ray'),
                   '"Ray joined" notification');
  r := qa.call(v_req, 'select json_agg(m)::text from public.my_join_requests() m');
  perform qa.check((qa.ok(r, 'my_join_requests')::jsonb -> 0 ->> 'household_name') = 'Secret home',
                   'approved request reveals the household name');
  perform qa.check(qa.ok(qa.call(v_req, 'select count(*)::text from public.tasks'), 'tasks') = '1', 'now sees tasks');
  perform qa.err(qa.call(qa.get('p_coord')::uuid, format('select public.approve_join_request(%L)::text', v_request)),
                 'join_request_closed', 'approve twice');
  perform qa.pass('[30.3] only the coordinator approves; approved requester becomes a member and is announced');
end $$;

-- [30.4] 拒绝、每 uid 一条 pending、每户 5 条上限、24 小时过期、同意时复查人数上限
do $$
declare
  v_hid uuid := qa.get('p_hid')::uuid;     -- 现在已有 3 名成员（Free 上限 3）
  v_coord uuid := qa.get('p_coord')::uuid;
  v_code text := qa.get('p_code');
  v_other_hid uuid := qa.household(qa.user('apple'), 'Other home');
  v_other_code text := qa.code_for(v_other_hid);
  v_r2 uuid := qa.user('anonymous');
  v_r3 uuid := qa.user('anonymous');
  v jsonb;
  v2 jsonb;
  i int;
begin
  -- 拒绝
  v := qa.ok(qa.call(v_r2, format('select public.join_by_code_v2(%L, %L)::text', v_code, 'Second')), 'r2 pending')::jsonb;
  perform qa.check(v ->> 'status' = 'pending', 'r2 pending');
  v2 := qa.ok(qa.call(v_r2, format('select public.join_by_code_v2(%L)::text', v_other_code)), 'r2 other')::jsonb;
  perform qa.check(v2 ->> 'status' = 'already_pending' and v2 ->> 'request_id' = v ->> 'request_id',
                   'a second household while one request is pending → already_pending (no second request)');
  perform qa.check(not exists (select 1 from public.household_join_requests where household_id = v_other_hid),
                   'nothing was filed against the other household');
  perform qa.ok(qa.call(v_coord, format('select public.reject_join_request(%L)::text', v ->> 'request_id')), 'reject');
  perform qa.check((select status from public.household_join_requests where id = (v ->> 'request_id')::uuid) = 'rejected',
                   'status rejected');
  perform qa.check(not exists (select 1 from public.members where user_id = v_r2), 'rejected requester is not a member');
  perform qa.err(qa.call(v_coord, format('select public.reject_join_request(%L)::text', v ->> 'request_id')),
                 'join_request_closed', 'reject twice');
  perform qa.check(
    not exists (select 1 from public.audit_events where household_id = v_hid and action = 'member.join_rejected'
                and detail like '%Second%'),
    'reject audit does not store the requester name'
  );

  -- 同意时复查人数上限（H 已满 3 人）
  v := qa.ok(qa.call(v_r3, format('select public.join_by_code_v2(%L, %L)::text', v_code, 'Third')), 'r3 pending')::jsonb;
  perform qa.err(qa.call(v_coord, format('select public.approve_join_request(%L)::text', v ->> 'request_id')),
                 'join_member_limit', 'approve rechecks the member limit');
  perform qa.check((select status from public.household_join_requests where id = (v ->> 'request_id')::uuid) = 'pending',
                   'still pending after a refused approval');

  -- 24 小时过期：my_join_requests 显示 expired；同意报 join_request_expired；再提交会开新申请
  update public.household_join_requests set created_at = now() - interval '25 hours' where id = (v ->> 'request_id')::uuid;
  perform qa.check(qa.ok(qa.call(v_r3, 'select (array_agg(status))[1] from public.my_join_requests()'), 'mine') = 'expired',
                   'old pending shows as expired');
  perform qa.err(qa.call(v_coord, format('select public.approve_join_request(%L)::text', v ->> 'request_id')),
                 'join_request_expired', 'cannot approve an expired request');
  v2 := qa.ok(qa.call(v_r3, format('select public.join_by_code_v2(%L, %L)::text', v_code, 'Third')), 'r3 again')::jsonb;
  perform qa.check(v2 ->> 'status' = 'pending' and v2 ->> 'request_id' <> v ->> 'request_id', 'a new pending request');
  perform qa.check((select status from public.household_join_requests where id = (v ->> 'request_id')::uuid) = 'expired',
                   'stale request marked expired');

  -- 每户最多 5 条 pending（r3 已占 1 条）
  for i in 1..4 loop
    v := qa.ok(qa.call(qa.user('anonymous'), format('select public.join_by_code_v2(%L)::text', v_code)), 'fill')::jsonb;
    perform qa.check(v ->> 'status' = 'pending', 'pending #' || (i + 1));
  end loop;
  v := qa.ok(qa.call(qa.user('anonymous'), format('select public.join_by_code_v2(%L)::text', v_code)), '6th')::jsonb;
  perform qa.check(v ->> 'status' = 'requests_full', '6th pending request → requests_full');

  -- 熔断中码错：invalid 且计入失败
  v := qa.ok(qa.call(qa.user('anonymous'), format('select public.join_by_code_v2(%L)::text', qa.unused_code())), 'bad')::jsonb;
  perform qa.check(v ->> 'status' = 'invalid', 'wrong code while tripped → invalid');
  perform qa.pass('[30.4] reject, one pending per uid, 5 per household, 24h expiry, member limit rechecked');
end $$;


-- [30.5] 发布范围与权限
do $$
declare
  v_uid uuid := qa.user('anonymous');
begin
  perform qa.check(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                           and schemaname = 'public' and tablename = 'household_join_requests'),
                   'household_join_requests is in supabase_realtime');
  perform qa.denied(qa.call(null, 'select count(*)::text from public.household_join_requests', 'anon'), 'anon cannot read requests');
  perform qa.denied(qa.call(null, format('select public.approve_join_request(%L)::text', gen_random_uuid()), 'anon'),
                    'anon cannot approve');
  perform qa.denied(qa.call(null, 'select count(*)::text from public.my_join_requests()', 'anon'), 'anon cannot list');
  perform qa.check(qa.ok(qa.call(v_uid, 'select count(*)::text from public.my_join_requests()'), 'empty list') = '0',
                   'a user without requests sees an empty list');
  perform qa.pass('[30.5] realtime publication and API-role permissions');
end $$;

select qa.reset_join_guards();

-- [30.6] 评审 major 的回归：熔断期间，已有 pending 的 uid 不能靠反复提交已知码无限续命，
--        也不能借「已有申请」的回答探测别人家的码是否有效
do $$
declare
  v_accomplice_hid uuid := qa.household(qa.user('apple'), 'Accomplice home');
  v_accomplice_code text := qa.code_for(v_accomplice_hid);
  v_victim_hid uuid := qa.household(qa.user('apple'), 'Victim home');
  v_victim_code text := qa.code_for(v_victim_hid);
  v_m uuid := qa.user('anonymous');
  v jsonb;
  v_first jsonb;
  v_valid jsonb;
  v_invalid jsonb;
  v_failures int;
  v_victim_notes int;
  i int;
  v_rate_limited boolean := false;
begin
  update public.join_breaker set tripped_until = now() + interval '30 minutes', trips = 1 where id = 1;

  -- 1) M 用一个已知码（同伙的码）提交申请。
  v_first := qa.ok(qa.call(v_m, format('select public.join_by_code_v2(%L, %L)::text', v_accomplice_code, 'Mom')), 'M first')::jsonb;
  perform qa.check(v_first ->> 'status' = 'pending', 'M files one request');

  -- 2) 20 次乱猜，每 4 次夹一次已知码：第 5 次之后就被限流，计数从不清零。
  for i in 1..20 loop
    v := qa.ok(qa.call(v_m, format('select public.join_by_code_v2(%L)::text',
                                   case when i % 4 = 0 then v_accomplice_code else qa.unused_code() end)), 'M guess')::jsonb;
    if v ->> 'status' = 'rate_limited' then
      v_rate_limited := true;
    else
      perform qa.check(v ->> 'status' = 'already_pending', 'guess ' || i || ' → already_pending, got ' || v::text);
    end if;
  end loop;
  perform qa.check(v_rate_limited, 'M hits rate_limited');
  perform qa.check((select attempts from public.join_attempts where user_id = v_m) = 5, 'M''s counter reached 5 and stayed there');

  -- 3) 新的 15 分钟窗口：有效的别人家码和无效码得到完全相同的回答；不写申请、不通知、不计全站失败。
  update public.join_attempts set window_start = now() - interval '16 minutes' where user_id = v_m;
  select coalesce(sum(failures), 0) into v_failures from public.join_failure_windows;
  select count(*) into v_victim_notes from public.role_notifications where household_id = v_victim_hid;
  v_valid := qa.ok(qa.call(v_m, format('select public.join_by_code_v2(%L)::text', v_victim_code)), 'M probes victim')::jsonb;
  v_invalid := qa.ok(qa.call(v_m, format('select public.join_by_code_v2(%L)::text', qa.unused_code())), 'M probes junk')::jsonb;
  perform qa.check(v_valid = v_invalid, 'valid other-household code and invalid code give the same answer: '
                   || v_valid::text || ' vs ' || v_invalid::text);
  perform qa.check(v_valid ->> 'status' = 'already_pending' and v_valid ->> 'request_id' = v_first ->> 'request_id',
                   'the answer only points at M''s own request');
  perform qa.check(not exists (select 1 from public.household_join_requests where household_id = v_victim_hid),
                   'no request against the victim household');
  perform qa.check((select count(*) from public.role_notifications where household_id = v_victim_hid) = v_victim_notes,
                   'victim coordinator not notified');
  perform qa.check((select coalesce(sum(failures), 0) from public.join_failure_windows) = v_failures,
                   'probes before the code lookup do not touch the global counter');
  perform qa.check((select attempts from public.join_attempts where user_id = v_m) = 2, 'both probes counted per uid');
  perform qa.check(not exists (select 1 from public.members where user_id = v_m), 'M never became a member');

  -- 4) 对照：没有 pending 的 uid 猜中受害者的码 → 写申请并通知受害者的协调人（猜中只能换来一条看得见的申请）。
  v := qa.ok(qa.call(qa.user('anonymous'), format('select public.join_by_code_v2(%L)::text', v_victim_code)), 'fresh uid')::jsonb;
  perform qa.check(v ->> 'status' = 'pending', 'a fresh uid hitting the victim code files a request');
  perform qa.check((select count(*) from public.role_notifications where household_id = v_victim_hid
                    and title_key = 'notification.title.joinRequested') = 1, 'victim coordinator notified once');
  perform qa.pass('[30.6] tripped: one known code cannot refill the counter; a pending uid learns nothing from probing');
end $$;

select qa.reset_join_guards();

-- ============================================================================
-- 0061 被放弃的匿名账号自动清理：本地回归测试（只在加载了 pending_migrations 的库里运行）
-- ============================================================================

-- 把一个用户的「最后活动」挪到 p_ago 以前（users.created_at / last_sign_in_at）。
create or replace function qa.age(p_uid uuid, p_ago interval)
returns void
language sql
as $$
  update auth.users set created_at = now() - p_ago, last_sign_in_at = now() - p_ago where id = p_uid;
$$;

-- [50.0] 搭场景（单独一个事务；候选函数是 STABLE，要在后面的语句里才能看到这些行）
do $$
declare
  v uuid;
  v_hid uuid;
  v_session uuid;
begin
  -- empty：没有任何数据
  v := qa.user('anonymous'); perform qa.age(v, interval '31 days'); perform qa.set('e1', v::text);   -- 选中
  v := qa.user('anonymous'); perform qa.age(v, interval '29 days'); perform qa.set('e2', v::text);   -- 未到 30 天
  v := qa.user('anonymous'); perform qa.age(v, interval '40 days'); perform qa.set('e3', v::text);   -- refresh_tokens 最近有活动
  insert into auth.refresh_tokens (token, user_id, revoked, created_at, updated_at)
  values ('qa-token-' || v::text, v::text, false, now() - interval '40 days', now() - interval '2 days');

  -- solo：数据只属于自己
  v := qa.user('anonymous'); v_hid := qa.household(v, 'Solo 181'); perform qa.age(v, interval '181 days');
  perform qa.set('s1', v::text); perform qa.set('s1_hid', v_hid::text);                              -- 选中
  insert into public.tasks (household_id, title, requested_by_id) values (v_hid, 'Old task', qa.member_id(v_hid, v));

  v := qa.user('anonymous'); perform qa.household(v, 'Solo 179'); perform qa.age(v, interval '179 days');
  perform qa.set('s2', v::text);                                                                     -- 未到 180 天

  v := qa.user('anonymous'); v_hid := qa.household(v, 'Shared'); perform qa.age(v, interval '400 days');
  perform qa.add_member(v_hid, qa.user('apple'), 'caregiver', 'Family');
  perform qa.set('s3', v::text); perform qa.set('s3_hid', v_hid::text);                              -- 家里还有别人：永不

  v := qa.user('anonymous'); v_hid := qa.household(v, 'Payer'); perform qa.age(v, interval '400 days');
  insert into public.subscriptions (household_id, original_transaction_id, plan, expires_at, status, owner_user_id, owner_app_account_token)
  values (v_hid, 'otx-ret-' || v::text, 'monthly', now() - interval '200 days', 'expired', v, v);
  perform qa.set('s4', v::text);                                                                     -- 名下有订阅：不选

  v := qa.user('apple'); perform qa.household(v, 'Bound'); perform qa.age(v, interval '400 days');
  perform qa.set('s5', v::text);                                                                     -- 非匿名：不选

  v := qa.user('anonymous_apple'); perform qa.household(v, 'Linked'); perform qa.age(v, interval '400 days');
  perform qa.set('s6', v::text);                                                                     -- 已挂 Apple：不选

  v := qa.user('anonymous'); perform qa.household(v, 'Recent session'); perform qa.age(v, interval '400 days');
  v_session := gen_random_uuid();
  insert into auth.sessions (id, user_id, created_at, updated_at, refreshed_at)
  values (v_session, v, now() - interval '400 days', now() - interval '400 days',
          (now() - interval '1 day') at time zone 'UTC');
  perform qa.set('s7', v::text);                                                                     -- sessions.refreshed_at 最近：不选

  v := qa.user('anonymous'); v_hid := qa.household(v, 'Pending invite'); perform qa.age(v, interval '400 days');
  perform qa.add_member(v_hid, null, 'caregiver', 'Invited', 'pending');
  perform qa.set('s8', v::text);                                                                     -- 有 pending 成员：不选

  v := qa.user('anonymous'); v_hid := qa.household(v, 'Race'); perform qa.age(v, interval '200 days');
  perform qa.set('s9', v::text); perform qa.set('s9_hid', v_hid::text);                              -- 列出后有人加入

  v := qa.user('anonymous'); perform qa.household(v, 'Email request'); perform qa.age(v, interval '15 days');
  perform qa.set('s10', v::text);                                                                    -- 单用户模式（14 天）
end $$;

-- [50.1] 候选筛选
do $$
declare
  v_found text;
begin
  select string_agg(k.k || ':' || c.kind, ',' order by k.k) into v_found
    from public.anonymous_retention_candidates(500) c
    join qa.vars k on k.v = c.user_id::text
    where k.k in ('e1', 'e2', 'e3', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10');
  perform qa.check(v_found = 'e1:empty,s1:solo,s9:solo', 'candidates = e1:empty,s1:solo,s9:solo; got ' || coalesce(v_found, 'none'));
  perform qa.check(
    public.anonymous_last_activity(qa.get('s7')::uuid) > now() - interval '2 days',
    'last activity takes sessions.refreshed_at (timestamp without time zone, UTC)'
  );
  perform qa.check(
    public.anonymous_last_activity(qa.get('e3')::uuid) > now() - interval '3 days',
    'last activity takes refresh_tokens.updated_at (user_id is varchar)'
  );
  perform qa.check(not exists (select 1 from public.anonymous_retention_candidates(500) c
                               join public.members m on m.user_id = c.user_id
                               join public.members o on o.household_id = m.household_id and o.id <> m.id
                                                    and o.invite_status in ('active', 'pending')),
                   'no candidate shares a household with another active/pending member');
  perform qa.pass('[50.1] candidates: empty 31d and solo 181d selected; 29d/179d, shared, payer, bound, recent session/token, pending member excluded');
end $$;

-- [50.2] 锁内复查后删除：solo 删整户（进 Storage 清理队列）；empty 删数据；不再满足条件的什么都不删
do $$
declare
  v_s1 uuid := qa.get('s1')::uuid;
  v_s1_hid uuid := qa.get('s1_hid')::uuid;
  v_s9 uuid := qa.get('s9')::uuid;
  v_s9_hid uuid := qa.get('s9_hid')::uuid;
  v_s3_hid uuid := qa.get('s3_hid')::uuid;
begin
  perform qa.check(public.purge_anonymous_account_data(v_s1) = 'solo', 'purge s1 → solo');
  perform qa.check(not exists (select 1 from public.households where id = v_s1_hid), 's1 household deleted');
  perform qa.check(not exists (select 1 from public.tasks where household_id = v_s1_hid), 's1 tasks deleted');
  perform qa.check(exists (select 1 from public.account_deletion_storage_cleanup where user_id = v_s1 and household_id = v_s1_hid),
                   's1 storage cleanup queued for the Edge Function');

  perform qa.check(public.purge_anonymous_account_data(qa.get('e1')::uuid) = 'empty', 'purge e1 → empty');

  perform qa.check(public.purge_anonymous_account_data(qa.get('s3')::uuid) is null, 'shared household is never purged');
  perform qa.check(exists (select 1 from public.households where id = v_s3_hid), 's3 household kept');

  -- 列出之后有人加入：复查拒绝
  perform qa.add_member(v_s9_hid, qa.user('apple'), 'caregiver', 'Late joiner');
end $$;

do $$
begin
  perform qa.check(public.purge_anonymous_account_data(qa.get('s9')::uuid) is null, 'recheck refuses once someone joined');
  perform qa.check(exists (select 1 from public.households where id = qa.get('s9_hid')::uuid), 's9 household kept');
  perform qa.check(public.purge_anonymous_account_data(gen_random_uuid()) is null, 'unknown uid → null');
  perform qa.check(public.purge_anonymous_account_data(qa.get('s10')::uuid) is null, '15 days is too recent for the daily job');
  perform qa.pass('[50.2] purge rechecks under lock: solo/empty deleted, shared or changed accounts untouched');
end $$;

-- [50.3] 单用户模式（邮件删号申请）：同样的条件，不活跃门槛 14 天
do $$
declare
  v_s10 uuid := qa.get('s10')::uuid;
begin
  perform qa.check(not exists (select 1 from public.anonymous_retention_candidates(500) where user_id = v_s10),
                   's10 not in the daily candidates');
  perform qa.check((select kind from public.anonymous_retention_candidates(1, v_s10)) = 'solo', 'single-user mode finds s10');
  perform qa.check(not exists (select 1 from public.anonymous_retention_candidates(1, qa.get('s3')::uuid)),
                   'single-user mode still refuses a shared household');
  perform qa.check(public.purge_anonymous_account_data(v_s10, true) = 'solo', 'single-user purge');
  perform qa.pass('[50.3] single-user mode keeps every condition except the 14-day inactivity threshold');
end $$;

-- [50.4] 定时调用与权限
do $$
declare
  v_uid uuid := qa.user('anonymous');
  r qa.result;
begin
  begin
    perform public.invoke_purge_abandoned_anonymous();
    raise exception 'FAIL: invoke_purge_abandoned_anonymous should refuse without pg_net / Vault';
  exception when others then
    perform qa.check(sqlerrm like 'pg_net and Supabase Vault are required%', 'clear error without pg_net/Vault: ' || sqlerrm);
  end;
  perform qa.denied(qa.call(null, 'select public.invoke_purge_abandoned_anonymous()::text', 'service_role'),
                    'service_role cannot invoke the cron entry point');
  perform qa.denied(qa.call(v_uid, 'select count(*)::text from public.anonymous_retention_candidates(5)'),
                    'authenticated cannot list candidates');
  perform qa.denied(qa.call(v_uid, format('select public.purge_anonymous_account_data(%L)::text', v_uid)),
                    'authenticated cannot purge');
  perform qa.denied(qa.call(v_uid, format('select public.anonymous_last_activity(%L)::text', v_uid)),
                    'authenticated cannot read last activity');
  r := qa.call(null, 'select count(*)::text from public.anonymous_retention_candidates(5)', 'service_role');
  perform qa.ok(r, 'service_role can list candidates');
  perform qa.pass('[50.4] cron entry point fails closed; retention functions are service_role only');
end $$;

drop function if exists qa.age(uuid, interval);

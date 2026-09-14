-- ============================================================================
-- delete_account_data 回归测试（0053）
-- 证明：协调家庭级联删除；其他家庭成员匿名化软删除；restrictive FK 安全。
--
-- 无需真实 secret。两种运行方式：
--   1) Supabase 本地：cd backend/supabase && supabase start
--      然后 psql "$(supabase status -o json | jq -r .DB_URL)" < backend/qa/delete_account_regression.sql
--   2) 远端 SQL Editor（service role / postgres）：粘贴执行（脚本末 rollback，不污染数据）。
--
-- 脚本整体在事务内执行并回滚；任一断言失败即 RAISE，便于 CI/人工识别。
-- 说明：members.user_id / households.created_by / user_household_context.user_id
--      均 REFERENCES auth.users(id)，因此每个合成 UUID 先用 qa_seed_auth_user()
--      补一条最小 auth.users 行（只用各版本都存在的稳定列；事务回滚时随之一并撤销）。
--      证明点 = delete_account_data 不再因 restrictive FK 报错 + 成员行被匿名化软删除
--      （user_id=NULL, invite_status='removed'），且随后删除该 auth.users 行成功
--      （= Edge Function admin.auth.admin.deleteUser 不会因外键失败的前置条件）。
-- ============================================================================

begin;

-- 为合成 UUID 补 auth.users 行（FK 目标）。只用各版本都存在的稳定列：
-- 注意不含 instance_id —— 现代 GoTrue 已移除该列（PK 仅为 id）。
-- security definer 且 search_path 仅 pg_catalog，调用方无需对 auth schema 有直接权限。
create or replace function qa_seed_auth_user(p_id uuid) returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  insert into auth.users
    (id, aud, role, email, encrypted_password, email_confirmed_at,
     raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (p_id, 'authenticated', 'authenticated',
     p_id || '@qa.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())
  on conflict (id) do nothing;
end;
$$;

-- ----------------------------------------------------------------------------
-- 0) 环境前置检查：0053 版本函数已部署
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'delete_account_data'
  ) then
    raise exception 'FAIL: delete_account_data 函数不存在（未部署 0053?）';
  end if;
  -- 0053 关键模式：不应残留对 members 的直删（0011 的错误路径）
  if position('delete from public.members' in pg_get_functiondef('public.delete_account_data(uuid)'::regprocedure)) > 0 then
    raise exception 'FAIL: delete_account_data 仍含对 members 的硬删路径';
  end if;
  if position('invite_status = ''removed''' in pg_get_functiondef('public.delete_account_data(uuid)'::regprocedure)) = 0 then
    raise exception 'FAIL: delete_account_data 缺少匿名化软删除标记 invite_status removed';
  end if;
  if to_regclass('public.account_deletion_storage_cleanup') is null then
    raise exception 'FAIL: 缺少可重试 Storage 清理队列表';
  end if;
  raise notice 'PASS [0] 0053 delete_account_data 已部署且无 members 硬删路径';
end $$;

-- ----------------------------------------------------------------------------
-- 1) 场景 A：协调人删除自己的家庭（级联删除全部数据）+ 在别的家庭作普通成员
--    coordinator user_A：家庭 H1（A 是协调人）、H2（A 是 caregiver，非协调）
-- ----------------------------------------------------------------------------
do $$
declare
  v_uid_a uuid := gen_random_uuid();
  v_uid_b uuid := gen_random_uuid();
  v_uid_c uuid := gen_random_uuid();

  v_h1 uuid;
  v_h2 uuid;

  v_m_a1 uuid; -- A 在 H1 的协调人成员
  v_m_b  uuid; -- B 在 H1 的 caregiver
  v_m_a2 uuid; -- A 在 H2 的 caregiver 成员
  v_m_c2 uuid; -- C 在 H2 的 caregiver

  v_task1 uuid;
  v_task_doc uuid;
  v_doc1 uuid;
  v_audit1 uuid;

  v_h1_after bigint;
  v_m_a2_name text;
  v_audit2 uuid;
begin
  -- FK 目标补行
  perform qa_seed_auth_user(v_uid_a);
  perform qa_seed_auth_user(v_uid_b);
  perform qa_seed_auth_user(v_uid_c);

  -- 家庭与成员
  insert into public.households (name, timezone, invite_expires_at, care_recipient_label, created_by)
  values ('H1', 'America/Los_Angeles', now() + interval '48 hours', 'Care recipient', v_uid_a)
  returning id into v_h1;
  insert into public.households (name, timezone, invite_expires_at, care_recipient_label, created_by)
  values ('H2', 'America/Los_Angeles', now() + interval '48 hours', 'Care recipient', v_uid_b)
  returning id into v_h2;

  insert into public.members (household_id, user_id, name, relation, role, timezone, availability, invite_status)
  values (v_h1, v_uid_a, 'Alice', 'sibling', 'coordinator', 'America/Los_Angeles', '', 'active')
  returning id into v_m_a1;
  insert into public.members (household_id, user_id, name, relation, role, timezone, availability, invite_status)
  values (v_h1, v_uid_b, 'Bob', 'child', 'caregiver', 'America/Los_Angeles', '', 'active')
  returning id into v_m_b;
  insert into public.members (household_id, user_id, name, relation, role, timezone, availability, invite_status)
  values (v_h2, v_uid_a, 'Alice', 'friend', 'caregiver', 'America/Los_Angeles', '', 'active')
  returning id into v_m_a2;
  insert into public.members (household_id, user_id, name, relation, role, timezone, availability, invite_status)
  values (v_h2, v_uid_c, 'Carol', 'child', 'caregiver', 'America/Los_Angeles', '', 'active')
  returning id into v_m_c2;

  insert into public.notification_preferences (household_id, member_id) values (v_h1, v_m_a1), (v_h1, v_m_b), (v_h2, v_m_a2), (v_h2, v_m_c2);
  insert into public.user_household_context (user_id, household_id, updated_at) values (v_uid_a, v_h1, now());
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_h2, v_m_a2, 'member.name_updated', 'member', v_m_a2::text, 'Alice updated a profile.')
  returning id into v_audit2;
  insert into public.role_notifications (household_id, audience, severity, title_key, body_key, values, entity_type, entity_id)
  values (v_h2, 'coordinator', 'info', 'notification.title.memberJoined', 'notification.body.memberJoined',
          jsonb_build_object('name', 'Alice'), 'member', v_m_a2::text);

  -- H1 里 A 创建的内容（restrictive FK 关联）
  insert into public.tasks (household_id, title, requested_by_id, owner_id) values (v_h1, 'A 的任务', v_m_a1, v_m_a1) returning id into v_task1;
  insert into public.documents (household_id, name, uploaded_by_id, source) values (v_h1, 'scan.pdf', v_m_a1, 'manual_upload') returning id into v_doc1;
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_h1, v_m_a1, 'task.created', 'task', v_task1::text, 'A created a task.') returning id into v_audit1;

  -- 执行删除（A 删除账号；应级联删除 H1，H2 里 A 的成员匿名化软删除）
  perform public.delete_account_data(v_uid_a);

  -- 断言 1：H1 及其全部数据已级联删除
  select count(*) into v_h1_after from public.households where id = v_h1;
  if v_h1_after <> 0 then raise exception 'FAIL: 协调家庭 H1 未删除'; end if;
  if exists (select 1 from public.tasks where id = v_task1) then raise exception 'FAIL: 协调家庭任务未级联删除'; end if;
  if exists (select 1 from public.documents where id = v_doc1) then raise exception 'FAIL: 协调家庭文档未级联删除'; end if;
  if exists (select 1 from public.audit_events where id = v_audit1) then raise exception 'FAIL: 协调家庭审计未级联删除'; end if;
  if exists (select 1 from public.members where household_id = v_h1) then raise exception 'FAIL: 协调家庭成员未级联删除'; end if;
  if not exists (
    select 1 from public.account_deletion_storage_cleanup
    where user_id = v_uid_a and household_id = v_h1
  ) then raise exception 'FAIL: H1 的 Storage 清理目标未持久化'; end if;

  -- 断言 2：H2 中 A 的成员行被匿名化软删除（保留行，user_id NULL + removed + 占位名）
  select name into v_m_a2_name from public.members where id = v_m_a2;
  if not exists (select 1 from public.members where id = v_m_a2 and user_id is null) then
    raise exception 'FAIL: H2 中 A 的 user_id 未置空';
  end if;
  if not exists (select 1 from public.members where id = v_m_a2 and invite_status = 'removed') then
    raise exception 'FAIL: H2 中 A 未标记 removed';
  end if;
  if v_m_a2_name <> 'Deleted member' then
    raise exception 'FAIL: H2 中 A 未匿名化为占位符 (got %)', v_m_a2_name;
  end if;
  if exists (select 1 from public.notification_preferences where member_id = v_m_a2) then
    raise exception 'FAIL: H2 中 A 的通知偏好未删除';
  end if;
  if exists (select 1 from public.audit_events where id = v_audit2 and detail like '%Alice%') then
    raise exception 'FAIL: H2 中 A 的系统审计详情仍含资料姓名';
  end if;
  if exists (
    select 1 from public.role_notifications
    where household_id = v_h2 and entity_id = v_m_a2::text and values->>'name' <> 'Deleted member'
  ) then raise exception 'FAIL: H2 中 A 的系统通知仍含资料姓名'; end if;
  -- H2 及其它成员（B 协调人 C 成员）不受影响
  if not exists (select 1 from public.households where id = v_h2) then raise exception 'FAIL: 他人协调的 H2 被误删'; end if;
  if not exists (select 1 from public.members where id = v_m_c2) then raise exception 'FAIL: H2 其他成员被误删'; end if;

  -- 断言 3：delete_account_data 后，auth 用户行可被删除
  -- （Edge Function 里 admin.auth.admin.deleteUser 的前置条件；若仍有 FK 引用会在此报错）。
  delete from auth.users where id = v_uid_a;
  if exists (select 1 from auth.users where id = v_uid_a) then
    raise exception 'FAIL: auth.users 行未被删除（deleteUser 前置条件不成立）';
  end if;

  raise notice 'PASS [1] 协调家庭级联删除 + 其他家庭成员匿名化软删除 + auth 用户可删';
end $$;

-- ----------------------------------------------------------------------------
-- 2) 场景 B：非协调成员（caregiver）删账号 —— 有 authored content，
--    jobs/文档/审计都引用他的成员行 -> 硬删会撞 restrictive FK，旧实现必 500。
-- ----------------------------------------------------------------------------
do $$
declare
  v_uid_d uuid := gen_random_uuid();
  v_uid_e uuid := gen_random_uuid();
  v_h3 uuid;
  v_m_coord uuid;
  v_m_d uuid;
  v_task_d uuid;
  v_task_owner uuid;
  v_doc_d uuid;
  v_audit_d uuid;
begin
  perform qa_seed_auth_user(v_uid_d);
  perform qa_seed_auth_user(v_uid_e);

  insert into public.households (name, timezone, invite_expires_at, care_recipient_label, created_by)
  values ('H3', 'America/Los_Angeles', now() + interval '48 hours', 'Care recipient', v_uid_e)
  returning id into v_h3;
  insert into public.members (household_id, user_id, name, relation, role, timezone, availability, invite_status)
  values (v_h3, v_uid_e, 'Erin', 'coordinator', 'coordinator', 'America/Los_Angeles', '', 'active')
  returning id into v_m_coord;
  insert into public.members (household_id, user_id, name, relation, role, timezone, availability, invite_status)
  values (v_h3, v_uid_d, 'Dan', 'caregiver', 'caregiver', 'America/Los_Angeles', '', 'active')
  returning id into v_m_d;

  -- D 创建任务 / 领取任务（作为 owner）/ 上传文档 / 触发审计
  insert into public.tasks (household_id, title, requested_by_id) values (v_h3, 'D 创建', v_m_d) returning id into v_task_d;
  insert into public.tasks (household_id, title, requested_by_id, owner_id) values (v_h3, 'D 领取', v_m_coord, v_m_d) returning id into v_task_owner;
  insert into public.documents (household_id, name, uploaded_by_id, source) values (v_h3, 'd-scanned.pdf', v_m_d, 'manual_upload') returning id into v_doc_d;
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_h3, v_m_d, 'task.completed', 'task', v_task_d::text, 'D completed a task.') returning id into v_audit_d;

  -- 核心断言：旧实现会在这里 `delete from members` 撞 restrict FK；
  -- 旧实现（0011）在 H3 里直接删 D 的成员行 -> 报外键错误 -> delete_account_data raise。
  -- 0053 必须成功，且保持行、置空 user_id。
  perform public.delete_account_data(v_uid_d);

  -- D 的成员行保留且匿名化
  if not exists (select 1 from public.members where id = v_m_d and user_id is null and invite_status = 'removed' and name = 'Deleted member') then
    raise exception 'FAIL: caregiver D 未被正确匿名化软删除';
  end if;
  -- D 创建的内容保留（归属已删除成员占位符），FK 未破坏
  if not exists (select 1 from public.tasks where id = v_task_d) then raise exception 'FAIL: D 创建的任务不应被删'; end if;
  if not exists (select 1 from public.tasks where id = v_task_owner and owner_id = v_m_d) then raise exception 'FAIL: D 领取的任务 owner 引用丢失'; end if;
  if not exists (select 1 from public.documents where id = v_doc_d) then raise exception 'FAIL: D 上传的文档不应被删'; end if;
  if not exists (select 1 from public.audit_events where id = v_audit_d and actor_id = v_m_d) then raise exception 'FAIL: D 的审计 record actor 引用丢失'; end if;
  -- 家庭和其他成员不受影响
  if not exists (select 1 from public.households where id = v_h3) then raise exception 'FAIL: 非协调家庭成员不应删除家庭'; end if;
  if not exists (select 1 from public.members where id = v_m_coord) then raise exception 'FAIL: 协调人成员被误删'; end if;

  raise notice 'PASS [2] caregiver/viewer authored content 保留，restrictive FK 安全';
end $$;

-- ----------------------------------------------------------------------------
-- 3) 场景 C：viewer（只读成员，无内容）+ 匿名加入（anonymous-join）账号删账号
--    匿名加入：cookie/session 本质也是 auth.users 里的匿名 uid，members.user_id 指向它。
-- ----------------------------------------------------------------------------
do $$
declare
  v_uid_f uuid := gen_random_uuid(); -- viewer
  v_uid_g uuid := gen_random_uuid(); -- 匿名 joined caregiver
  v_uid_h uuid := gen_random_uuid(); -- coordinator
  v_h4 uuid;
  v_m_f uuid;
  v_m_g uuid;
begin
  perform qa_seed_auth_user(v_uid_f);
  perform qa_seed_auth_user(v_uid_g);
  perform qa_seed_auth_user(v_uid_h);

  insert into public.households (name, timezone, invite_expires_at, care_recipient_label, created_by)
  values ('H4', 'America/Los_Angeles', now() + interval '48 hours', 'Care recipient', v_uid_h)
  returning id into v_h4;
  insert into public.members (household_id, user_id, name, relation, role, timezone, availability, invite_status)
  values (v_h4, v_uid_h, 'Harry', 'coordinator', 'coordinator', 'America/Los_Angeles', '', 'active');
  insert into public.members (household_id, user_id, name, relation, role, timezone, availability, invite_status)
  values (v_h4, v_uid_f, 'Fran', 'viewer', 'viewer', 'America/Los_Angeles', '', 'active')
  returning id into v_m_f;
  insert into public.members (household_id, user_id, name, relation, role, timezone, availability, invite_status)
  values (v_h4, v_uid_g, 'Guest', 'joined by code', 'caregiver', 'America/Los_Angeles', '', 'active')
  returning id into v_m_g;

  perform public.delete_account_data(v_uid_f);
  perform public.delete_account_data(v_uid_g);

  if not exists (select 1 from public.members where id = v_m_f and user_id is null and invite_status = 'removed') then
    raise exception 'FAIL: viewer F 未匿名化';
  end if;
  if not exists (select 1 from public.members where id = v_m_g and user_id is null and invite_status = 'removed') then
    raise exception 'FAIL: 匿名加入 G 未匿名化';
  end if;
  if not exists (select 1 from public.members where user_id = v_uid_h and invite_status = 'active') then
    raise exception 'FAIL: 家庭协调人成员被误影响';
  end if;

  raise notice 'PASS [3] viewer + anonymous-join 成员匿名化成功';
end $$;

-- ----------------------------------------------------------------------------
-- 4) 场景 D：多家庭协调人（协调 H5 与 H6）删账号 -> 两个协调家庭都删除
-- ----------------------------------------------------------------------------
do $$
declare
  v_uid_i uuid := gen_random_uuid();
  v_uid_j uuid := gen_random_uuid();
  v_h5 uuid;
  v_h6 uuid;
  v_left bigint;
begin
  perform qa_seed_auth_user(v_uid_i);
  perform qa_seed_auth_user(v_uid_j);

  insert into public.households (name, timezone, invite_expires_at, care_recipient_label, created_by)
  values ('H5', 'America/Los_Angeles', now() + interval '48 hours', 'Care recipient', v_uid_j)
  returning id into v_h5;
  insert into public.members (household_id, user_id, name, relation, role, timezone, availability, invite_status)
  values (v_h5, v_uid_i, 'Ivy', 'coordinator', 'coordinator', 'America/Los_Angeles', '', 'active');
  insert into public.members (household_id, user_id, name, relation, role, timezone, availability, invite_status)
  values (v_h5, v_uid_j, 'Joy', 'caregiver', 'caregiver', 'America/Los_Angeles', '', 'active');

  insert into public.households (name, timezone, invite_expires_at, care_recipient_label, created_by)
  values ('H6', 'America/Los_Angeles', now() + interval '48 hours', 'Care recipient', v_uid_i)
  returning id into v_h6;
  insert into public.members (household_id, user_id, name, relation, role, timezone, availability, invite_status)
  values (v_h6, v_uid_i, 'Ivy', 'coordinator', 'coordinator', 'America/Los_Angeles', '', 'active');

  perform public.delete_account_data(v_uid_i);

  select count(*) into v_left from public.households where id in (v_h5, v_h6);
  if v_left <> 0 then raise exception 'FAIL: 多协调家庭未全部级联删除'; end if;
  -- H5 中他人成员也随家庭级联删除
  if exists (select 1 from public.members where user_id = v_uid_j) then raise exception 'FAIL: H5 成员未随家庭级联删除'; end if;

  raise notice 'PASS [4] 多家庭协调全部级联删除';
end $$;

-- ----------------------------------------------------------------------------
-- 5) 场景 E：restrictive FK 的原始 bug 复现证明（对照）
--    delete from public.members 仍会被 tasks/documents/audit 拒绝；
--    证明 0053 走匿名化路径的必要性。
-- ----------------------------------------------------------------------------
do $$
declare
  v_uid_k uuid := gen_random_uuid();
  v_uid_l uuid := gen_random_uuid();
  v_h7 uuid;
  v_m_k uuid;
  v_locked boolean := false;
begin
  perform qa_seed_auth_user(v_uid_k);
  perform qa_seed_auth_user(v_uid_l);

  insert into public.households (name, timezone, invite_expires_at, care_recipient_label, created_by)
  values ('H7', 'America/Los_Angeles', now() + interval '48 hours', 'Care recipient', v_uid_l)
  returning id into v_h7;
  insert into public.members (household_id, user_id, name, relation, role, timezone, availability, invite_status)
  values (v_h7, v_uid_l, 'Lou', 'coordinator', 'coordinator', 'America/Los_Angeles', '', 'active');
  insert into public.members (household_id, user_id, name, relation, role, timezone, availability, invite_status)
  values (v_h7, v_uid_k, 'Ken', 'caregiver', 'caregiver', 'America/Los_Angeles', '', 'active')
  returning id into v_m_k;
  insert into public.tasks (household_id, title, requested_by_id) values (v_h7, 'Ken 的任务', v_m_k);
  insert into public.documents (household_id, name, uploaded_by_id, source) values (v_h7, 'k.pdf', v_m_k, 'manual_upload');
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_h7, v_m_k, 'task.created', 'task', v_m_k::text, 'Ken created a task.');

  begin
    delete from public.members where id = v_m_k;
    -- 未报错说明环境里 FK 不存在（异常）=> 标记
    v_locked := false;
  exception
    when foreign_key_violation then
      v_locked := true;
  end;

  if not v_locked then
    raise exception 'FAIL: 预期 members 硬删被 restrictive FK 拒绝但未拒绝';
  end if;

  raise notice 'PASS [5] restrictive FK 确实拒绝成员硬删 => 0053 匿名化路径必要';
end $$;

-- ----------------------------------------------------------------------------
-- 汇总
-- ----------------------------------------------------------------------------

rollback;

-- 0008: Family Plus 付费墙 - entitlement 模型 + 服务端硬配额
--
-- 设计：entitlement 挂在 household 上（plus_plan/plus_until/plus_owner_id）。
-- Free / Plus(monthly|yearly) 两档。配额在 RPC 层强制（防客户端绕过）。
-- 存储：不做按家庭配额（Supabase 免费版 1GB 项目总量兜底），仅限单文件 25MB。
-- 通知：Free 保留基础角色通知；Plus 解锁摘要/静默/自动周报（客户端控制）。

-- ============ households 加 entitlement 列 ============
alter table public.households
  add column if not exists plus_plan text not null default 'free' check (plus_plan in ('free','monthly','yearly')),
  add column if not exists plus_until timestamptz,
  add column if not exists plus_owner_id uuid references public.members(id) on delete set null;

-- ============ documents 加 size_bytes ============
alter table public.documents
  add column if not exists size_bytes bigint not null default 0;

-- ============ 有效套餐（检查到期） ============
create or replace function public.effective_plan(p_household_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select case
    when plus_plan in ('monthly','yearly') and coalesce(plus_until, now()) >= now() then plus_plan
    else 'free'
  end
  from public.households
  where id = p_household_id;
$$;

-- ============ 重写 create_household：限制家庭数（Free 1 / Plus 3） ============
create or replace function public.create_household(
  p_household_name text,
  p_timezone text,
  p_care_recipient_label text,
  p_member_name text,
  p_member_relation text,
  p_member_timezone text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_member_id uuid;
  v_existing int;
  v_has_plus boolean;
  v_limit int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- 统计当前用户作为协调人已加入的家庭数，以及是否已有 Plus
  select count(*), bool_or(public.effective_plan(household_id) in ('monthly','yearly'))
    into v_existing, v_has_plus
    from public.members
    where user_id = auth.uid()
      and role = 'coordinator'
      and invite_status = 'active';
  v_existing := coalesce(v_existing, 0);
  v_limit := case when coalesce(v_has_plus, false) then 3 else 1 end;
  if v_existing >= v_limit then
    raise exception 'Household limit reached (%) for your plan. Upgrade to Family Plus for more.', v_limit;
  end if;

  insert into public.households (name, timezone, care_recipient_label, invite_expires_at, created_by)
  values (p_household_name, p_timezone, p_care_recipient_label, now() + interval '48 hours', auth.uid())
  returning id into v_household_id;

  insert into public.members (household_id, user_id, name, relation, role, timezone, invite_status)
  values (v_household_id, auth.uid(), p_member_name, p_member_relation, 'coordinator', p_member_timezone, 'active')
  returning id into v_member_id;

  insert into public.notification_preferences (household_id, member_id) values (v_household_id, v_member_id);

  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_household_id, v_member_id, 'household.created', 'household', v_household_id::text,
          'Created household with non-PHI MVP mode enabled.');

  return v_household_id;
end;
$$;

-- ============ 重写 create_task_with_activity：限制进行中任务（Free 10） ============
create or replace function public.create_task_with_activity(
  p_household_id uuid, p_title text, p_expected_minutes integer, p_due_at timestamptz,
  p_priority text, p_subtasks jsonb default '[]'::jsonb, p_event_id uuid default null,
  p_document_id uuid default null
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_task_id uuid;
  v_actor_id uuid := public.current_member_id();
  v_actor_name text;
  v_plan text;
  v_count int;
  v_limit int;
begin
  if v_actor_id is null or not public.can_coordinate_work() then raise exception 'Task creation is not permitted'; end if;
  v_plan := public.effective_plan(p_household_id);
  v_limit := case when v_plan in ('monthly','yearly') then 999999 else 10 end;
  select count(*) into v_count from public.tasks
    where household_id = p_household_id and status <> 'completed';
  if v_count >= v_limit then
    raise exception 'In-progress task limit reached (%) for % plan. Upgrade to Family Plus for unlimited.', v_limit, v_plan;
  end if;
  select name into v_actor_name from public.members where id = v_actor_id;
  insert into public.tasks (household_id, title, expected_minutes, due_at, priority, status, requested_by_id, event_id, document_id, subtasks)
  values (p_household_id, p_title, p_expected_minutes, p_due_at, p_priority, 'open', v_actor_id, p_event_id, p_document_id, coalesce(p_subtasks, '[]'::jsonb))
  returning id into v_task_id;
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (p_household_id, v_actor_id, 'task.created', 'task', v_task_id::text, format('%s created task "%s".', v_actor_name, p_title));
  insert into public.role_notifications (household_id, audience, severity, title_key, body_key, values, entity_type, entity_id)
  values (p_household_id, 'caregiver', case when p_priority = 'critical' then 'critical' else 'info' end,
    case when p_priority = 'critical' then 'notification.title.criticalTask' else 'notification.title.newTask' end,
    'notification.body.claimableTask', jsonb_build_object('task', p_title, 'priority', p_priority), 'task', v_task_id::text);
  return v_task_id;
end;
$$;

-- ============ invite_member：限制成员数（Free 3 / Plus 12）+ 原子建邀请 ============
-- 返回 invite token。替代客户端多步写（member + pref + invite + audit + notification）。
create or replace function public.invite_member(
  p_household_id uuid,
  p_role text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor_id uuid := public.current_member_id();
  v_actor_name text;
  v_member_id uuid;
  v_token uuid;
  v_plan text;
  v_count int;
  v_limit int;
  v_invite_name text;
begin
  if v_actor_id is null or not public.is_coordinator() then
    raise exception 'Only a coordinator can invite members';
  end if;
  if p_role not in ('caregiver','viewer') then
    raise exception 'Invite role must be caregiver or viewer';
  end if;
  v_plan := public.effective_plan(p_household_id);
  v_limit := case when v_plan in ('monthly','yearly') then 12 else 3 end;
  select count(*) into v_count from public.members where household_id = p_household_id;
  if v_count >= v_limit then
    raise exception 'Member limit reached (%) for % plan. Upgrade to Family Plus for more.', v_limit, v_plan;
  end if;
  select name into v_actor_name from public.members where id = v_actor_id;
  v_invite_name := case when p_role = 'caregiver' then 'New caregiver invite' else 'New viewer invite' end;
  insert into public.members (household_id, name, role, invite_status, invite_expires_at)
  values (p_household_id, v_invite_name, p_role, 'pending', now() + interval '48 hours')
  returning id into v_member_id;
  insert into public.notification_preferences (household_id, member_id) values (p_household_id, v_member_id);
  insert into public.invites (household_id, member_id) values (p_household_id, v_member_id) returning token into v_token;
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (p_household_id, v_actor_id, 'member.invited', 'member', v_member_id::text,
          format('%s invited a new %s.', v_actor_name, p_role));
  insert into public.role_notifications (household_id, audience, severity, title_key, body_key, values, entity_type, entity_id)
  values (p_household_id, p_role, 'info', 'notification.title.memberInvited', 'notification.body.memberInvited',
          jsonb_build_object('role', p_role), 'member', v_member_id::text);
  return v_token;
end;
$$;
revoke all on function public.invite_member(uuid, text) from public;
grant execute on function public.invite_member(uuid, text) to authenticated;

-- ============ create_document：单文件 25MB + OCR 月配额（Free 1 / Plus 50）+ 原子插入 ============
-- 返回 document id。客户端先上传 storage，再调本 RPC；若 RPC 拒绝需清理已上传文件。
create or replace function public.create_document(
  p_household_id uuid,
  p_name text,
  p_uploaded_by_id uuid,
  p_source text,
  p_size_bytes bigint,
  p_confidence double precision,
  p_suggested_action text,
  p_storage_path text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_doc_id uuid;
  v_actor_id uuid := public.current_member_id();
  v_actor_name text;
  v_plan text;
  v_count int;
  v_limit int;
  v_max_size bigint := 26214400; -- 25 MB
begin
  if v_actor_id is null or not public.can_coordinate_work() then
    raise exception 'Document upload is not permitted';
  end if;
  if p_size_bytes > v_max_size then
    raise exception 'File too large. Maximum 25 MB per file.';
  end if;
  -- OCR 月配额仅对真实上传计；sample 不计。
  if p_source = 'manual_upload' then
    v_plan := public.effective_plan(p_household_id);
    v_limit := case when v_plan in ('monthly','yearly') then 50 else 1 end;
    select count(*) into v_count from public.documents
      where household_id = p_household_id and source = 'manual_upload'
        and date_trunc('month', uploaded_at) = date_trunc('month', now());
    if v_count >= v_limit then
      raise exception 'Monthly OCR limit reached (%) for % plan. Upgrade to Family Plus for more.', v_limit, v_plan;
    end if;
  end if;
  select name into v_actor_name from public.members where id = v_actor_id;
  insert into public.documents (household_id, name, uploaded_by_id, status, contains_phi, confidence, source, suggested_action, storage_path, size_bytes)
  values (p_household_id, p_name, p_uploaded_by_id, 'pending_confirmation', false, p_confidence, p_source, p_suggested_action, p_storage_path, p_size_bytes)
  returning id into v_doc_id;
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (p_household_id, v_actor_id, 'document.uploaded', 'document', v_doc_id::text,
          format('%s uploaded "%s"; manual confirmation required.', v_actor_name, p_name));
  insert into public.role_notifications (household_id, audience, severity, title_key, body_key, values, entity_type, entity_id)
  values (p_household_id, 'coordinator', 'info', 'notification.title.documentUploaded', 'notification.body.documentUploaded',
          jsonb_build_object('document', p_name), 'document', v_doc_id::text);
  return v_doc_id;
end;
$$;
revoke all on function public.create_document(uuid, text, uuid, text, bigint, double precision, text, text) from public;
grant execute on function public.create_document(uuid, text, uuid, text, bigint, double precision, text, text) to authenticated;

-- ============ 手动设置 Plus（dev/测试用，或后续 webhook 调用） ============
-- 上线后真实购买由校验 Edge Function 调用本 RPC 写入 entitlement。
create or replace function public.set_household_plus(
  p_household_id uuid,
  p_plan text,
  p_owner_member_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_plan not in ('free','monthly','yearly') then
    raise exception 'Invalid plan';
  end if;
  update public.households
    set plus_plan = p_plan,
        plus_until = case when p_plan = 'free' then null else now() + interval '365 days' end,
        plus_owner_id = case when p_plan = 'free' then null else p_owner_member_id end
    where id = p_household_id;
end;
$$;
revoke all on function public.set_household_plus(uuid, text, uuid) from public;
-- 注意：上线前应改为仅校验 Edge Function 的 service role 可调；开发期暂 grant authenticated 便于测试。
grant execute on function public.set_household_plus(uuid, text, uuid) to authenticated;

-- ============ 审计保留期清理（Free 30 天 / Plus 3 年）============
-- 由 Supabase pg_cron 或定时 Edge Function 每日调用。
create or replace function public.cleanup_old_audit()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  h record;
  v_days int;
begin
  for h in select id, public.effective_plan(id) as plan from public.households loop
    v_days := case when h.plan in ('monthly','yearly') then 1095 else 30 end;
    delete from public.audit_events
      where household_id = h.id and created_at < now() - make_interval(days => v_days);
  end loop;
end;
$$;
revoke all on function public.cleanup_old_audit() from public;
grant execute on function public.cleanup_old_audit() to authenticated;

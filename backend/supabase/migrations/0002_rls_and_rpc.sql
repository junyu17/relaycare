-- TaskKin Care MVP - RLS policies, helper function, RPCs, realtime
-- 依赖 0001_init_schema.sql 已建表。

-- ============ RLS 启用 ============
alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.role_definitions enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.role_notifications enable row level security;
alter table public.tasks enable row level security;
alter table public.care_events enable row level security;
alter table public.documents enable row level security;
alter table public.audit_events enable row level security;

-- 辅助函数：当前认证用户所属的 household_id（security definer 绕过 RLS，避免递归）
create or replace function public.current_household_id()
returns uuid
language sql
security definer
stable
as $$
  select household_id
  from public.members
  where user_id = auth.uid() and invite_status = 'active'
  limit 1;
$$;

-- ============ Policies ============
-- households
create policy "households: select own" on public.households
  for select using (id = public.current_household_id());
create policy "households: insert by creator" on public.households
  for insert with check (created_by = auth.uid());
create policy "households: update own" on public.households
  for update using (id = public.current_household_id());

-- members（创建者首条 member 由 create_household RPC 写入，绕过 RLS）
create policy "members: select household" on public.members
  for select using (household_id = public.current_household_id());
create policy "members: insert household" on public.members
  for insert with check (household_id = public.current_household_id());
create policy "members: update household" on public.members
  for update using (household_id = public.current_household_id());

-- role_definitions: 全局只读
create policy "role_definitions: read all" on public.role_definitions
  for select using (true);

-- 业务表按 household 隔离
create policy "np: household all" on public.notification_preferences
  for all using (household_id = public.current_household_id());
create policy "rn: household select" on public.role_notifications
  for select using (household_id = public.current_household_id());
create policy "rn: household insert" on public.role_notifications
  for insert with check (household_id = public.current_household_id());
create policy "tasks: household all" on public.tasks
  for all using (household_id = public.current_household_id());
create policy "events: household all" on public.care_events
  for all using (household_id = public.current_household_id());
create policy "documents: household all" on public.documents
  for all using (household_id = public.current_household_id());

-- audit_events: 只读 + 插入（不删不改）
create policy "audit: household select" on public.audit_events
  for select using (household_id = public.current_household_id());
create policy "audit: household insert" on public.audit_events
  for insert with check (household_id = public.current_household_id());

-- ============ RPC: 创建家庭 ============
-- 注册用户调用：一次性创建 household + 自己的 coordinator member + 通知偏好 + 审计事件。
-- security definer 绕过 RLS，解决"首条 member 写入前 current_household_id 为空"的鸡生蛋问题。
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
as $$
declare
  v_household_id uuid;
  v_member_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
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

-- ============ RPC: 接受邀请 ============
-- 被邀请人注册后，凭邀请链接里的 member_id 加入家庭：
-- 把 pending member 的 user_id 设为当前用户、状态置 active。
create or replace function public.accept_invite(
  p_member_id uuid,
  p_display_name text default null
) returns void
language plpgsql
security definer
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.members
  set user_id = auth.uid(),
      invite_status = 'active',
      name = coalesce(p_display_name, name)
  where id = p_member_id
    and invite_status = 'pending'
    and user_id is null
    and (invite_expires_at is null or invite_expires_at > now());
end;
$$;

-- ============ Realtime ============
-- 启用实时发布（app 端订阅这些表的变更，实现多设备实时同步）
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.members;
alter publication supabase_realtime add table public.care_events;
alter publication supabase_realtime add table public.documents;
alter publication supabase_realtime add table public.audit_events;
alter publication supabase_realtime add table public.role_notifications;
alter publication supabase_realtime add table public.notification_preferences;

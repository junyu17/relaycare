-- 0015: 成员变动通知 + 解散通知所有成员
--
-- - 加入/退出 -> role_notification 通知协调人（家庭仍在，实时推送）。
-- - 解散/移除 -> user_notifications（per-user，家庭删除后仍存活）通知受影响成员。
-- - user_notifications 表 + RLS（用户只能读/改自己的）。

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('household_dissolved','removed_from_household')),
  household_name text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists user_notifications_user_idx on public.user_notifications (user_id, created_at desc);
alter table public.user_notifications enable row level security;
create policy "user_notif: select own" on public.user_notifications
  for select using (user_id = auth.uid());
create policy "user_notif: update own" on public.user_notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- insert 仅由下面的 service definer RPC（service_role 调用）执行；客户端不可直接 insert。
revoke insert, delete on public.user_notifications from anon, authenticated;

alter publication supabase_realtime add table public.user_notifications;

-- ============ 重写 join_by_code：加入后通知协调人 ============
create or replace function public.join_by_code(
  p_code text,
  p_display_name text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code public.household_codes%rowtype;
  v_member_id uuid;
  v_count int;
  v_limit int;
  v_att public.join_attempts%rowtype;
  v_name text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_code !~ '^[0-9]{6}$' then raise exception 'Code must be 6 digits'; end if;

  select * into v_att from public.join_attempts where user_id = v_uid for update;
  if not found then
    insert into public.join_attempts (user_id, attempts, window_start) values (v_uid, 0, now());
    select * into v_att from public.join_attempts where user_id = v_uid;
  end if;
  if now() - v_att.window_start > interval '15 minutes' then
    update public.join_attempts set attempts = 1, window_start = now() where user_id = v_uid;
  else
    if v_att.attempts >= 5 then
      raise exception 'Too many join attempts. Please wait a few minutes and try again.';
    end if;
    update public.join_attempts set attempts = attempts + 1 where user_id = v_uid;
  end if;

  select * into v_code from public.household_codes where code = p_code and status = 'active' for update;
  if not found then raise exception 'Invalid or expired code'; end if;
  if v_code.expires_at <= now() then
    update public.household_codes set status = 'locked' where id = v_code.id;
    raise exception 'Code has expired. Ask the coordinator for a new one.';
  end if;

  select count(*) into v_count from public.members where household_id = v_code.household_id;
  v_limit := case when public.effective_plan(v_code.household_id) in ('monthly','yearly') then 12 else 3 end;
  if v_count >= v_limit then raise exception 'Household member limit reached (%)', v_limit; end if;

  if exists (select 1 from public.members where household_id = v_code.household_id and user_id = v_uid and invite_status = 'active') then
    raise exception 'You are already a member of this household';
  end if;

  v_name := coalesce(nullif(trim(p_display_name), ''), 'Family member');
  insert into public.members (household_id, user_id, name, relation, role, timezone, invite_status)
  values (v_code.household_id, v_uid, v_name, '', 'caregiver', 'America/Los_Angeles', 'active')
  returning id into v_member_id;
  insert into public.notification_preferences (household_id, member_id) values (v_code.household_id, v_member_id);

  insert into public.user_household_context (user_id, household_id, updated_at)
  values (v_uid, v_code.household_id, now())
  on conflict (user_id) do update set household_id = excluded.household_id, updated_at = now();

  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_code.household_id, v_member_id, 'member.joined', 'member', v_member_id::text, v_name || ' joined the household by code.');

  -- 通知协调人：有成员加入。
  insert into public.role_notifications (household_id, audience, severity, title_key, body_key, values, entity_type, entity_id)
  values (v_code.household_id, 'coordinator', 'info', 'notification.title.memberJoined', 'notification.body.memberJoined',
          jsonb_build_object('name', v_name), 'member', v_member_id::text);

  update public.join_attempts set attempts = 0 where user_id = v_uid;
  return v_code.household_id;
end;
$$;
revoke all on function public.join_by_code(text, text) from public;
grant execute on function public.join_by_code(text, text) to authenticated;

-- ============ 重写 leave_household：退出后通知协调人 ============
create or replace function public.leave_household(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_member public.members%rowtype;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into v_member from public.members
    where household_id = p_household_id and user_id = v_uid and invite_status = 'active';
  if not found then raise exception 'You are not a member of this household'; end if;
  if v_member.role = 'coordinator' then
    raise exception 'Coordinators cannot leave. Dissolve the household instead.';
  end if;
  delete from public.members where id = v_member.id;
  delete from public.user_household_context where user_id = v_uid and household_id = p_household_id;
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (p_household_id, v_member.id, 'member.left', 'member', v_member.id::text, v_member.name || ' left the household.');
  -- 通知协调人：有成员退出。
  insert into public.role_notifications (household_id, audience, severity, title_key, body_key, values, entity_type, entity_id)
  values (p_household_id, 'coordinator', 'info', 'notification.title.memberLeft', 'notification.body.memberLeft',
          jsonb_build_object('name', v_member.name), 'member', v_member.id::text);
end;
$$;
revoke all on function public.leave_household(uuid) from public;
grant execute on function public.leave_household(uuid) to authenticated;

-- ============ 重写 remove_member：通知被移除的成员 ============
create or replace function public.remove_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hid uuid := public.current_household_id();
  v_actor uuid := public.current_member_id();
  v_target public.members%rowtype;
begin
  if v_actor is null or not public.is_coordinator() then
    raise exception 'Only a coordinator can remove members';
  end if;
  if p_member_id = v_actor then
    raise exception 'Cannot remove yourself. Use leave or dissolve.';
  end if;
  select * into v_target from public.members where id = p_member_id and household_id = v_hid;
  if not found then raise exception 'Member not found in this household'; end if;

  -- 通知被移除的成员（家庭删除前写入；user_notifications 存活）。
  if v_target.user_id is not null then
    insert into public.user_notifications (user_id, kind, household_name)
    values (v_target.user_id, 'removed_from_household', (select name from public.households where id = v_hid));
  end if;

  delete from public.members where id = p_member_id;
  delete from public.user_household_context where user_id = v_target.user_id and household_id = v_hid;
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_hid, v_actor, 'member.removed', 'member', p_member_id::text, 'Coordinator removed ' || v_target.name || '.');
end;
$$;
revoke all on function public.remove_member(uuid) from public;
grant execute on function public.remove_member(uuid) to authenticated;

-- ============ 重写 dissolve_household：通知所有成员后解散 ============
create or replace function public.dissolve_household()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hid uuid := public.current_household_id();
  v_actor uuid := public.current_member_id();
  v_name text;
  m record;
begin
  if v_actor is null or not public.is_coordinator() then
    raise exception 'Only a coordinator can dissolve the household';
  end if;
  select name into v_name from public.households where id = v_hid;
  -- 通知所有成员（user_notifications 在家庭删除后仍存活，客户端订阅后弹通知 + 退出）。
  for m in select distinct user_id from public.members where household_id = v_hid and user_id is not null loop
    insert into public.user_notifications (user_id, kind, household_name)
    values (m.user_id, 'household_dissolved', v_name);
  end loop;
  -- 级联删除：members/tasks/events/documents/audit/role_notifications/household_codes 等随 household 删除。
  delete from public.households where id = v_hid;
end;
$$;
revoke all on function public.dissolve_household() from public;
grant execute on function public.dissolve_household() to authenticated;

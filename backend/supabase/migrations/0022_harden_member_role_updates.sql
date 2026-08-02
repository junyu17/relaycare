-- 0022: harden member role updates before launch.
--
-- Remote policy history can retain the old household-wide members update
-- policy. That allows any active household member to directly update role via
-- the public anon key. Drop the broad policy again and route role changes
-- through a coordinator-only RPC. Also make update_my_name target the active
-- household member instead of the newest member across all households.

drop policy if exists "members: update household" on public.members;
drop policy if exists "members: update coordinator" on public.members;

create policy "members: update coordinator" on public.members
  for update using (
    household_id = public.current_household_id()
    and public.is_coordinator()
    and id <> public.current_member_id()
    and invite_status <> 'removed'
  ) with check (
    household_id = public.current_household_id()
    and public.is_coordinator()
    and invite_status <> 'removed'
  );

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
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_role not in ('coordinator', 'caregiver', 'viewer') then raise exception 'Invalid role'; end if;

  select * into v_target
    from public.members
    where id = p_member_id
      and invite_status = 'active';
  if not found then raise exception 'Member not found in this household'; end if;

  select * into v_actor
    from public.members
    where household_id = v_target.household_id
      and user_id = v_uid
      and invite_status = 'active'
    limit 1;
  if not found or v_actor.role <> 'coordinator' then
    raise exception 'Only a coordinator can change member roles';
  end if;
  if v_actor.id = v_target.id then
    raise exception 'Cannot change your own role';
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

create or replace function public.update_my_name(p_display_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.members%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if nullif(trim(p_display_name), '') is null then raise exception 'Name cannot be empty'; end if;

  select * into v_member
    from public.members
    where user_id = auth.uid()
      and household_id = public.current_household_id()
      and invite_status = 'active'
    limit 1;

  if not found then raise exception 'Active member not found'; end if;

  update public.members set name = trim(p_display_name) where id = v_member.id;

  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_member.household_id, v_member.id, 'member.name_updated', 'member', v_member.id::text,
          'Updated display name to "' || trim(p_display_name) || '".');
end;
$$;

revoke all on function public.update_my_name(text) from public;
revoke all on function public.update_my_name(text) from anon;
grant execute on function public.update_my_name(text) to authenticated;

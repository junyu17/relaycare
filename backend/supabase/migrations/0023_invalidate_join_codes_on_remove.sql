-- 0023: invalidate active join codes when a member is removed.
--
-- Otherwise a removed member who still knows the 6-digit code can immediately
-- rejoin the same household. Coordinators can generate a fresh code when they
-- intentionally want to add members again.

create or replace function public.remove_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_actor public.members%rowtype;
  v_target public.members%rowtype;
  v_household_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_target
    from public.members
    where id = p_member_id
      and invite_status <> 'removed';
  if not found then
    raise exception 'Member not found in this household';
  end if;

  select * into v_actor
    from public.members
    where household_id = v_target.household_id
      and user_id = v_uid
      and invite_status = 'active'
    limit 1;
  if not found or v_actor.role <> 'coordinator' then
    raise exception 'Only a coordinator can remove members';
  end if;
  if p_member_id = v_actor.id then
    raise exception 'Cannot remove yourself. Use leave or dissolve.';
  end if;

  select name into v_household_name from public.households where id = v_target.household_id;

  if v_target.user_id is not null then
    insert into public.user_notifications (user_id, kind, household_name)
    values (v_target.user_id, 'removed_from_household', v_household_name);
  end if;

  update public.members
    set user_id = null, invite_status = 'removed'
    where id = p_member_id;

  update public.household_codes
    set status = 'locked'
    where household_id = v_target.household_id
      and status = 'active';

  if v_target.user_id is not null then
    delete from public.user_household_context
    where user_id = v_target.user_id and household_id = v_target.household_id;
  end if;

  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (
    v_target.household_id,
    v_actor.id,
    'member.removed',
    'member',
    p_member_id::text,
    'Coordinator removed ' || v_target.name || '.'
  );
end;
$$;

revoke all on function public.remove_member(uuid) from public;
revoke all on function public.remove_member(uuid) from anon;
grant execute on function public.remove_member(uuid) to authenticated;

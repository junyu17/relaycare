-- 0020: make member removal independent of active household context.
--
-- 0019 soft-deleted members, but remove_member still depended on
-- current_household_id(). In multi-household sessions that context can be
-- stale or unset, so a coordinator can tap Remove and see no visible change.
-- Resolve the target household from p_member_id, then verify the caller is an
-- active coordinator in that same household. Also stop removed members from
-- counting against join-code member limits.

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

  select count(*) into v_count
    from public.members
    where household_id = v_code.household_id
      and invite_status <> 'removed';
  v_limit := case when public.effective_plan(v_code.household_id) in ('monthly','yearly') then 12 else 3 end;
  if v_count >= v_limit then raise exception 'Household member limit reached (%)', v_limit; end if;

  if exists (
    select 1
    from public.members
    where household_id = v_code.household_id
      and user_id = v_uid
      and invite_status = 'active'
  ) then
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

  insert into public.role_notifications (household_id, audience, severity, title_key, body_key, values, entity_type, entity_id)
  values (v_code.household_id, 'coordinator', 'info', 'notification.title.memberJoined', 'notification.body.memberJoined',
          jsonb_build_object('name', v_name), 'member', v_member_id::text);

  update public.join_attempts set attempts = 0 where user_id = v_uid;
  return v_code.household_id;
end;
$$;
revoke all on function public.join_by_code(text, text) from public;
revoke all on function public.join_by_code(text, text) from anon;
grant execute on function public.join_by_code(text, text) to authenticated;

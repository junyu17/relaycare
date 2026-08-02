-- 0031: 成员操作加固（I2/I15）
--
-- I2: update_my_name 显式接收 p_household_id——不再依赖 current_household_id() 上下文
--（多家庭用户 context 缺失/指向错误家庭时会改名到错误家庭或报 Active member not found）。
-- 旧签名 update_my_name(text) 保留为 wrapper（向后兼容旧客户端）。
-- I15: join_by_code 增加家庭级 advisory lock，防并发 join 绕过成员数上限（Free 3 / Plus 12）。
--
create or replace function public.update_my_name(p_household_id uuid, p_display_name text)
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
      and household_id = p_household_id
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
revoke all on function public.update_my_name(uuid, text) from public;
revoke all on function public.update_my_name(uuid, text) from anon;
revoke all on function public.update_my_name(uuid, text) from service_role;
grant execute on function public.update_my_name(uuid, text) to authenticated;

create or replace function public.update_my_name(p_display_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.update_my_name(public.current_household_id(), p_display_name);
end;
$$;
revoke all on function public.update_my_name(text) from public;
grant execute on function public.update_my_name(text) to authenticated;

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

  -- I15: 家庭级 advisory lock（并发 join 串行化，防成员数检查与插入竞态超上限）
  perform pg_advisory_xact_lock(hashtext('household_join:' || v_code.household_id::text));

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

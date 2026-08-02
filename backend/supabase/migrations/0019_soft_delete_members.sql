-- 0019: 软删除成员（解决外键约束）
--
-- 问题：tasks.requested_by_id 和 audit_events.actor_id 是 NOT NULL REFERENCES members(id)
-- 且无 ON DELETE 动作（RESTRICT），直接 DELETE members 会报外键约束错误。
-- 方案：不删行，改为 user_id=NULL + invite_status='removed'。保留行维持引用完整性，
-- 断开登录关联（被移除者无法再访问），从活跃成员列表消失。

-- 1. invite_status 加 'removed' 值
alter table public.members drop constraint if exists members_invite_status_check;
alter table public.members
  add constraint members_invite_status_check
  check (invite_status in ('active', 'pending', 'removed'));

-- 2. 重写 remove_member：软删除
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

  -- 通知被移除的成员。
  if v_target.user_id is not null then
    insert into public.user_notifications (user_id, kind, household_name)
    values (v_target.user_id, 'removed_from_household', (select name from public.households where id = v_hid));
  end if;

  -- 软删除：断开登录关联 + 标记 removed。保留行以维持 tasks/audit 的外键引用。
  update public.members
    set user_id = null, invite_status = 'removed'
    where id = p_member_id;

  -- 清除活跃家庭上下文。
  delete from public.user_household_context where user_id = v_target.user_id and household_id = v_hid;

  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_hid, v_actor, 'member.removed', 'member', p_member_id::text, 'Coordinator removed ' || v_target.name || '.');
end;
$$;
revoke all on function public.remove_member(uuid) from public;
revoke all on function public.remove_member(uuid) from anon;
grant execute on function public.remove_member(uuid) to authenticated;

-- 3. 重写 leave_household：同样软删除
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

  -- 软删除：断开登录关联 + 标记 removed。
  update public.members
    set user_id = null, invite_status = 'removed'
    where id = v_member.id;

  delete from public.user_household_context where user_id = v_uid and household_id = p_household_id;
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (p_household_id, v_member.id, 'member.left', 'member', v_member.id::text, v_member.name || ' left the household.');

  insert into public.role_notifications (household_id, audience, severity, title_key, body_key, values, entity_type, entity_id)
  values (p_household_id, 'coordinator', 'info', 'notification.title.memberLeft', 'notification.body.memberLeft',
          jsonb_build_object('name', v_member.name), 'member', v_member.id::text);
end;
$$;
revoke all on function public.leave_household(uuid) from public;
revoke all on function public.leave_household(uuid) from anon;
grant execute on function public.leave_household(uuid) to authenticated;

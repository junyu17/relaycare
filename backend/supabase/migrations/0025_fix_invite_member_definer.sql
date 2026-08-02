-- 0025: invite_member 改 security definer
--
-- 0024 撤销了 authenticated 对 members 的表级 INSERT/UPDATE；invite_member 原为
-- security invoker（0008），内部 `insert into public.members` 会以 authenticated
-- 身份执行 -> permission denied，邀请成员功能上线即挂。
-- 函数内部已有完整授权校验（角色白名单 caregiver/viewer、Free 3 / Plus 12 成员数
-- 配额、审计+通知）；改 security definer + set search_path 后（current_user=postgres
-- 绕过 RLS），不再依赖 current_household_id() 上下文与无参 is_coordinator()（多家庭
-- 用户未设 user_household_context 时会 fallback 到最早家庭导致误拒/越权），改为按
-- auth.uid() + p_household_id 直接定位并校验 actor（须属于目标家庭且
-- role='coordinator' 且 invite_status='active'），防止任一家庭 coordinator 越权写
-- 他人家庭并借此拿 invite token 身份接管。

create or replace function public.invite_member(
  p_household_id uuid,
  p_role text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_actor_name text;
  v_member_id uuid;
  v_token uuid;
  v_plan text;
  v_count int;
  v_limit int;
  v_invite_name text;
begin
  select id, name into v_actor_id, v_actor_name
  from public.members
  where user_id = auth.uid()
    and household_id = p_household_id
    and role = 'coordinator'
    and invite_status = 'active';
  if v_actor_id is null then
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

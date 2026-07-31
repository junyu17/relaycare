-- 0019b: 修复 update_my_name RPC - 兼容 invite_status='removed'（0019 已加）
-- 问题：0018 的 update_my_name 用 current_household_id()，该函数依赖 user_household_context
-- + members.user_id = auth.uid() + invite_status = 'active'。如果 context 未设置或
-- member 被软删除（removed），RPC 报 "Active member not found"。
-- 修复：改为直接按 user_id + invite_status='active' 查 member，不依赖 current_household_id()。

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

  -- 直接按当前用户 + active 状态查 member（不依赖 current_household_id 的 context）。
  select * into v_member
    from public.members
    where user_id = auth.uid()
      and invite_status = 'active'
    order by created_at desc
    limit 1;

  if not found then raise exception 'Active member not found'; end if;

  update public.members set name = trim(p_display_name) where id = v_member.id;

  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_member.household_id, v_member.id, 'member.name_updated', 'member', v_member.id::text,
          'Updated display name to "' || trim(p_display_name) || '".');
end;
$$;
revoke all on function public.update_my_name(text) from public;
grant execute on function public.update_my_name(text) to authenticated;

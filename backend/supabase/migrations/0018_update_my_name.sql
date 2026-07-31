-- 0018: 成员自助修改显示名（RLS 只允许协调人改成员，普通成员需要自己的 RPC）
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
      and invite_status = 'active'
      and household_id = public.current_household_id();
  if not found then raise exception 'Active member not found'; end if;
  update public.members set name = trim(p_display_name) where id = v_member.id;
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_member.household_id, v_member.id, 'member.name_updated', 'member', v_member.id::text,
          'Updated display name to "' || trim(p_display_name) || '".');
end;
$$;
revoke all on function public.update_my_name(text) from public;
grant execute on function public.update_my_name(text) to authenticated;

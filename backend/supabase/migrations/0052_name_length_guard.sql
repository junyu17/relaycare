-- 0052: update_my_name 加业务长度上限（防滥用/UI 溢出；静态文案不泄露内部细节）
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
  if char_length(trim(p_display_name)) > 80 then raise exception 'Name is too long (max 80 characters)'; end if;

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

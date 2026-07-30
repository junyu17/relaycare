-- 0017: 删除误建的 task / timeline 事件
-- 协调人可删任意；普通成员只能删自己发起/负责的。删除写审计。
-- security definer 绕过 RLS（tasks/care_events 无 delete 策略），但内部做归属校验。

create or replace function public.delete_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks%rowtype;
  v_actor uuid := public.current_member_id();
begin
  if v_actor is null then raise exception 'Not authenticated'; end if;
  select * into v_task from public.tasks where id = p_task_id;
  if not found then raise exception 'Task not found'; end if;
  if not public.is_coordinator()
     and v_task.requested_by_id <> v_actor
     and (v_task.owner_id is null or v_task.owner_id <> v_actor) then
    raise exception 'You can only delete your own tasks';
  end if;
  delete from public.tasks where id = p_task_id;
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_task.household_id, v_actor, 'task.deleted', 'task', p_task_id::text,
          'Deleted task "' || v_task.title || '".');
end;
$$;
revoke all on function public.delete_task(uuid) from public;
grant execute on function public.delete_task(uuid) to authenticated;

create or replace function public.delete_care_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.care_events%rowtype;
  v_actor uuid := public.current_member_id();
begin
  if v_actor is null then raise exception 'Not authenticated'; end if;
  select * into v_event from public.care_events where id = p_event_id;
  if not found then raise exception 'Event not found'; end if;
  if not public.is_coordinator()
     and (v_event.owner_id is null or v_event.owner_id <> v_actor) then
    raise exception 'You can only delete your own timeline events';
  end if;
  delete from public.care_events where id = p_event_id;
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_event.household_id, v_actor, 'timeline.event_deleted', 'timeline', p_event_id::text,
          'Deleted timeline event "' || v_event.title || '".');
end;
$$;
revoke all on function public.delete_care_event(uuid) from public;
grant execute on function public.delete_care_event(uuid) to authenticated;

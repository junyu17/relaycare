-- 0032: LOW 残留加固（2026-08-02）
--
-- 1) guard_member_key_columns 补 BEFORE INSERT 分支（0024 仅挂 UPDATE）：
--    纵深防御——若未来恢复 authenticated 表级 INSERT，禁止直插带 user_id 的成员行
--    （身份注入面）；invite_member 等 definer RPC 以 postgres 执行不受影响。
-- 2) confirm_document_and_create_task 补 p_task_title 长度/空值校验（0029）。
--
create or replace function public.guard_member_key_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      -- 拒绝所有 anon/authenticated 直插 members（成员创建必须走 definer RPC：
      -- invite_member/join_by_code/create_household 等，current_user=postgres 不受影响）。
      raise exception 'Direct insert into members is not permitted';
    elsif new.role is distinct from old.role
       or new.user_id is distinct from old.user_id
       or new.invite_status is distinct from old.invite_status
    then
      raise exception 'Direct update of member role/identity columns is not permitted';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_member_key_columns on public.members;
create trigger trg_guard_member_key_columns
  before insert or update on public.members
  for each row execute function public.guard_member_key_columns();

-- confirm_document_and_create_task：标题非空且 <=200 字符
create or replace function public.confirm_document_and_create_task(
  p_document_id uuid,
  p_task_title text,
  p_due_at timestamptz,
  p_subtasks jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.documents%rowtype;
  v_actor_id uuid;
  v_actor_name text;
  v_task_id uuid;
begin
  if nullif(trim(p_task_title), '') is null then
    raise exception 'Task title cannot be empty';
  end if;
  if length(trim(p_task_title)) > 200 then
    raise exception 'Task title is too long (max 200 characters)';
  end if;

  select * into v_doc from public.documents where id = p_document_id for update;
  if not found then
    raise exception 'Document not found';
  end if;

  select id, name into v_actor_id, v_actor_name
  from public.members
  where user_id = auth.uid()
    and household_id = v_doc.household_id
    and invite_status = 'active'
    and role in ('coordinator', 'caregiver');
  if v_actor_id is null then
    raise exception 'Only an active coordinator or caregiver can confirm a document';
  end if;

  if v_doc.status = 'confirmed' then
    raise exception 'Document is already confirmed';
  end if;

  update public.documents set status = 'confirmed' where id = p_document_id;

  insert into public.tasks (household_id, title, expected_minutes, due_at, priority, status, requested_by_id, document_id, subtasks)
  values (v_doc.household_id, trim(p_task_title), 15, p_due_at, 'normal', 'open', v_actor_id, p_document_id, coalesce(p_subtasks, '[]'::jsonb))
  returning id into v_task_id;

  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_doc.household_id, v_actor_id, 'document.confirmed', 'document', p_document_id::text,
          format('%s confirmed document "%s".', v_actor_name, v_doc.name));
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_doc.household_id, v_actor_id, 'document.task_created', 'task', v_task_id::text,
          format('%s created task "%s" from document "%s".', v_actor_name, trim(p_task_title), v_doc.name));
  insert into public.role_notifications (household_id, audience, severity, title_key, body_key, values, entity_type, entity_id)
  values (v_doc.household_id, 'caregiver', 'info', 'notification.title.newTask', 'notification.body.claimableTask',
          jsonb_build_object('task', trim(p_task_title), 'priority', 'normal'), 'task', v_task_id::text);

  return v_task_id;
end;
$$;
revoke all on function public.confirm_document_and_create_task(uuid, text, timestamptz, jsonb) from public;
grant execute on function public.confirm_document_and_create_task(uuid, text, timestamptz, jsonb) to authenticated;

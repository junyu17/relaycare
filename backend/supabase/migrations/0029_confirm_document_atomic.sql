-- 0029: 文档确认→任务创建原子化（B7）
--
-- 原客户端流程 5 步非事务（documents.update → tasks.insert → 2×audit_events.insert
-- → role_notifications.insert），任一步失败留下半完成状态（document 已 confirmed 但
-- 无 task，或 task 已建但无审计/通知）。改为单一 security definer RPC 单事务提交。
--
-- 并发安全：row lock（for update）+ 状态检查，杜绝重复确认。
-- 授权：definer 化后显式校验 actor（auth.uid() + document 所属家庭 + active +
-- coordinator/caregiver），viewer 无权确认文档；document 必须存在且未 confirmed。
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
  -- 加 for update 防并发重复确认（两个请求同时通过状态检查会产生重复 task）。
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
  values (v_doc.household_id, p_task_title, 15, p_due_at, 'normal', 'open', v_actor_id, p_document_id, coalesce(p_subtasks, '[]'::jsonb))
  returning id into v_task_id;

  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_doc.household_id, v_actor_id, 'document.confirmed', 'document', p_document_id::text,
          format('%s confirmed document "%s".', v_actor_name, v_doc.name));
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_doc.household_id, v_actor_id, 'document.task_created', 'task', v_task_id::text,
          format('%s created task "%s" from document "%s".', v_actor_name, p_task_title, v_doc.name));
  insert into public.role_notifications (household_id, audience, severity, title_key, body_key, values, entity_type, entity_id)
  values (v_doc.household_id, 'caregiver', 'info', 'notification.title.newTask', 'notification.body.claimableTask',
          jsonb_build_object('task', p_task_title, 'priority', 'normal'), 'task', v_task_id::text);

  return v_task_id;
end;
$$;
revoke all on function public.confirm_document_and_create_task(uuid, text, timestamptz, jsonb) from public;
grant execute on function public.confirm_document_and_create_task(uuid, text, timestamptz, jsonb) to authenticated;

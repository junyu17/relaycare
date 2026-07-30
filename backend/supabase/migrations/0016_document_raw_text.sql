-- 0016: 持久化 OCR 原始文本，使文档页可显示识别结果（之前 OCR 文本计算后即丢弃，用户看不到）。
alter table public.documents add column if not exists raw_text text;

-- 重写 create_document：新增 p_raw_text 参数并写入 raw_text 列。
create or replace function public.create_document(
  p_household_id uuid,
  p_name text,
  p_uploaded_by_id uuid,
  p_source text,
  p_size_bytes bigint,
  p_confidence double precision,
  p_suggested_action text,
  p_storage_path text,
  p_raw_text text default null
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_doc_id uuid;
  v_actor_id uuid := public.current_member_id();
  v_actor_name text;
  v_plan text;
  v_count int;
  v_limit int;
  v_max_size bigint := 26214400; -- 25 MB
begin
  if v_actor_id is null or not public.can_coordinate_work() then
    raise exception 'Document upload is not permitted';
  end if;
  if p_size_bytes > v_max_size then
    raise exception 'File too large. Maximum 25 MB per file.';
  end if;
  if p_source = 'manual_upload' then
    v_plan := public.effective_plan(p_household_id);
    v_limit := case when v_plan in ('monthly','yearly') then 50 else 1 end;
    select count(*) into v_count from public.documents
      where household_id = p_household_id and source = 'manual_upload'
        and date_trunc('month', uploaded_at) = date_trunc('month', now());
    if v_count >= v_limit then
      raise exception 'Monthly OCR limit reached (%) for % plan. Upgrade to Family Plus for more.', v_limit, v_plan;
    end if;
  end if;
  select name into v_actor_name from public.members where id = v_actor_id;
  insert into public.documents (household_id, name, uploaded_by_id, status, contains_phi, confidence, source, suggested_action, storage_path, size_bytes, raw_text)
  values (p_household_id, p_name, p_uploaded_by_id, 'pending_confirmation', false, p_confidence, p_source, p_suggested_action, p_storage_path, p_size_bytes, p_raw_text)
  returning id into v_doc_id;
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (p_household_id, v_actor_id, 'document.uploaded', 'document', v_doc_id::text,
          format('%s uploaded "%s"; manual confirmation required.', v_actor_name, p_name));
  insert into public.role_notifications (household_id, audience, severity, title_key, body_key, values, entity_type, entity_id)
  values (p_household_id, 'coordinator', 'info', 'notification.title.documentUploaded', 'notification.body.documentUploaded',
          jsonb_build_object('document', p_name), 'document', v_doc_id::text);
  return v_doc_id;
end;
$$;
revoke all on function public.create_document(uuid, text, uuid, text, bigint, double precision, text, text, text) from public;
grant execute on function public.create_document(uuid, text, uuid, text, bigint, double precision, text, text, text) to service_role;

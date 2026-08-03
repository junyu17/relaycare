-- 0043: R3 M6——record_weekly_report 补发"周报已生成"协调人通知
-- （R2 删 recordReportGenerated 时连带删掉了 weeklyReady 通知，通知 key 成孤儿）。
-- 在现有 RPC 中追加 role_notifications 插入（audit 已有一次 report.generated，不重复）。
create or replace function public.record_weekly_report(
  p_household_id uuid,
  p_metrics jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mid uuid;
  v_name text;
begin
  select id, name into v_mid, v_name from public.members m
    where m.id = public.current_member_id()
      and m.household_id = p_household_id
      and m.role = 'coordinator' and m.invite_status = 'active';
  if v_mid is null then
    raise exception 'Only a coordinator can record a weekly report';
  end if;
  insert into public.weekly_reports (household_id, week_start, metrics)
  values (p_household_id, date_trunc('week', now())::date, coalesce(p_metrics, '{}'::jsonb))
  on conflict (household_id, week_start) do update
    set metrics = excluded.metrics, created_at = now();
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (p_household_id, v_mid, 'report.generated', 'report', p_household_id::text,
          format('%s recorded a weekly report.', coalesce(v_name, 'Coordinator')));
  -- M6：周报就绪通知（协调人受众；audience 按 R6 意图为 coordinator）
  insert into public.role_notifications (household_id, audience, severity, title_key, body_key, values, entity_type, entity_id)
  values (p_household_id, 'coordinator', 'info',
          'notification.title.weeklyReady', 'notification.body.weeklyReady',
          jsonb_build_object('count', coalesce((p_metrics->>'tasksCreated')::int, 0)), 'report', p_household_id::text);
end;
$$;
revoke all on function public.record_weekly_report(uuid, jsonb) from public;
revoke all on function public.record_weekly_report(uuid, jsonb) from anon;
grant execute on function public.record_weekly_report(uuid, jsonb) to authenticated;

-- 0044: R4 A1——周报通知 count 改 RPC 内实算未完成任务数
-- 0043 把客户端传入的 tasksCreated（本周新建数）当"待处理数"发给协调人，语义错误。
-- 三语文案为"待处理事项"，故在 RPC 内直接统计 status <> 'completed' 的任务数（与
-- 原 recordReportGenerated 的 openCount 口径一致），不依赖客户端传参。
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
  v_open int;
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
  -- A1：未完成任务数（status <> 'completed'），与三语"待处理"文案一致
  select count(*) into v_open from public.tasks
    where household_id = p_household_id and status <> 'completed';
  insert into public.role_notifications (household_id, audience, severity, title_key, body_key, values, entity_type, entity_id)
  values (p_household_id, 'coordinator', 'info',
          'notification.title.weeklyReady', 'notification.body.weeklyReady',
          jsonb_build_object('count', v_open), 'report', p_household_id::text);
end;
$$;
revoke all on function public.record_weekly_report(uuid, jsonb) from public;
revoke all on function public.record_weekly_report(uuid, jsonb) from anon;
grant execute on function public.record_weekly_report(uuid, jsonb) to authenticated;

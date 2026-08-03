-- 0036: update_notification_preference RPC（R5，IOS_SUBMISSION_DEV_SPEC）
--
-- 摘要（task_digest）与静默时段（quiet_hours_start/end）为 Family Plus 专属：
-- 服务端门禁（AC5-1：Free 用户直接 REST 调本 RPC 返回 'Family Plus required'，
-- 客户端 canUse('advancedNotifications') 只是 UX 提示，服务端为权威）。
-- 由 coordinator/caregiver/viewer 各自维护自己的偏好行。
create or replace function public.update_notification_preference(
  p_quiet_hours_start text,
  p_quiet_hours_end text,
  p_task_digest boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mid uuid;
  v_plan text;
begin
  v_mid := public.current_member_id();
  if v_mid is null then
    raise exception 'Not a household member';
  end if;

  -- 参数校验（24 小时制 HH:MM）
  if p_quiet_hours_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Invalid quiet hours start';
  end if;
  if p_quiet_hours_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Invalid quiet hours end';
  end if;

  -- R5 套餐门禁：摘要与静默时段仅 Plus 可用（服务端权威）
  select public.effective_plan(household_id) into v_plan
    from public.members where id = v_mid;
  if v_plan not in ('monthly', 'yearly') then
    raise exception 'Family Plus required';
  end if;

  update public.notification_preferences
    set quiet_hours_start = p_quiet_hours_start,
        quiet_hours_end = p_quiet_hours_end,
        task_digest = p_task_digest
    where member_id = v_mid;
end;
$$;
revoke all on function public.update_notification_preference(text, text, boolean) from public;
revoke all on function public.update_notification_preference(text, text, boolean) from anon;
grant execute on function public.update_notification_preference(text, text, boolean) to authenticated;

-- 0035: RTDN 订阅状态同步（play-rtdn Edge Function 调用）
--
-- 根据 Play 通知查询的最新状态更新 subscriptions 行并同步家庭权益：
--   active → plusUntil = p_expires_at；expired/revoked/canceled → 回退 free。
create or replace function public.sync_subscription_state(
  p_original_transaction_id text,
  p_status text,
  p_plan text,
  p_expires_at timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_member_id uuid;
begin
  if p_status not in ('active', 'expired', 'revoked', 'canceled') then
    raise exception 'Invalid subscription status';
  end if;
  if p_plan is null then
    -- 调用方未传 plan 时回退记录值（防御传播缺陷）
    select plan into p_plan from public.subscriptions where original_transaction_id = p_original_transaction_id;
  end if;
  if p_plan not in ('monthly', 'yearly') then
    raise exception 'Invalid plan';
  end if;

  select * into v_sub from public.subscriptions
    where original_transaction_id = p_original_transaction_id
    limit 1;
  if not found then
    raise exception 'Subscription not found';
  end if;

  update public.subscriptions
    set status = p_status,
        plan = p_plan,
        expires_at = p_expires_at,
        updated_at = now()
    where id = v_sub.id;

  if p_status = 'active' then
    -- 延长权益（需家庭内 active coordinator 作为 owner member）
    select id into v_member_id from public.members
      where household_id = v_sub.household_id
        and user_id = v_sub.owner_user_id
        and role = 'coordinator'
        and invite_status = 'active'
      limit 1;
    if v_member_id is not null then
      perform public.set_household_plus(v_sub.household_id, p_plan, v_member_id, p_expires_at);
    end if;
  else
    -- 取消/过期/撤销 → 回退 free
    perform public.set_household_plus(v_sub.household_id, 'free', null, null);
  end if;
end;
$$;
revoke all on function public.sync_subscription_state(text, text, text, timestamptz) from public;
revoke all on function public.sync_subscription_state(text, text, text, timestamptz) from anon;
revoke all on function public.sync_subscription_state(text, text, text, timestamptz) from authenticated;
grant execute on function public.sync_subscription_state(text, text, text, timestamptz) to service_role;

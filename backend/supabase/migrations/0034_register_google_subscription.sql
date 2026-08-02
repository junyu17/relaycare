-- 0034: Google Play 订阅登记（Android IAP 后端，与 register_apple_subscription 对称）
--
-- 由 verify-google-purchase Edge Function（Play Developer API 验证后）调用；
-- original_transaction_id 存 'g:' || purchaseToken（区分平台、防碰撞）；
-- 复用 subscriptions 表（household/owner 绑定、status 状态机、revoked/expired 拒重激活）。
create or replace function public.register_google_subscription(
  p_household_id uuid,
  p_original_transaction_id text,
  p_plan text,
  p_expires_at timestamptz,
  p_owner_member_id uuid,
  p_owner_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.subscriptions%rowtype;
begin
  if p_plan not in ('monthly', 'yearly') then
    raise exception 'Invalid subscription plan';
  end if;
  if p_original_transaction_id is null or p_original_transaction_id = '' then
    raise exception 'Missing transaction id';
  end if;

  insert into public.subscriptions (
    household_id, original_transaction_id, plan, expires_at, status,
    environment, owner_user_id
  ) values (
    p_household_id, p_original_transaction_id, p_plan, p_expires_at, 'active',
    'Google', p_owner_user_id
  )
  on conflict (original_transaction_id) do update
    set original_transaction_id = excluded.original_transaction_id
  returning * into v_sub;

  if v_sub.household_id is not null and v_sub.household_id <> p_household_id then
    raise exception 'This Google subscription is already linked to another household';
  end if;
  if v_sub.owner_user_id is not null and v_sub.owner_user_id <> p_owner_user_id then
    raise exception 'This Google subscription is linked to another account';
  end if;

  -- 已撤销/已过期订阅不可通过旧 purchaseToken 重新激活（与 0028 Apple 侧同款防护）。
  if v_sub.status in ('revoked', 'expired') then
    raise exception 'Subscription is revoked or expired and cannot be reactivated';
  end if;

  update public.subscriptions
    set household_id = coalesce(household_id, p_household_id),
        plan = p_plan,
        expires_at = p_expires_at,
        status = 'active',
        environment = 'Google',
        owner_user_id = coalesce(owner_user_id, p_owner_user_id),
        updated_at = now()
    where id = v_sub.id;

  insert into public.subscription_households (subscription_id, household_id)
  values (v_sub.id, p_household_id)
  on conflict do nothing;

  perform public.set_household_plus(p_household_id, p_plan, p_owner_member_id, p_expires_at);
end;
$$;
revoke all on function public.register_google_subscription(uuid, text, text, timestamptz, uuid, uuid) from public;
revoke all on function public.register_google_subscription(uuid, text, text, timestamptz, uuid, uuid) from anon;
revoke all on function public.register_google_subscription(uuid, text, text, timestamptz, uuid, uuid) from authenticated;
grant execute on function public.register_google_subscription(uuid, text, text, timestamptz, uuid, uuid) to service_role;

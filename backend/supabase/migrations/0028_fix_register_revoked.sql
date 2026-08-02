-- 0028: register_apple_subscription 禁止重新激活已撤销/已过期订阅（B5 纵深防御）
--
-- 背景：verify-apple-receipt 已在 purchase/restore 两条路径统一校验 subscriptions 状态
-- （revoked/expired 拒绝）；此处对 register 再做 DB 层兜底，防止任何调用方（含绕过
-- verify 的未来路径）用退款前签发的旧 JWS 把 entitlement 重置回 active。
--
create or replace function public.register_apple_subscription(
  p_household_id uuid,
  p_original_transaction_id text,
  p_plan text,
  p_expires_at timestamptz,
  p_environment text,
  p_last_transaction_id text,
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

  insert into public.subscriptions (
    household_id, original_transaction_id, plan, expires_at, status,
    environment, last_transaction_id, owner_user_id
  ) values (
    p_household_id, p_original_transaction_id, p_plan, p_expires_at, 'active',
    p_environment, p_last_transaction_id, p_owner_user_id
  )
  on conflict (original_transaction_id) do update
    set original_transaction_id = excluded.original_transaction_id
  returning * into v_sub;

  if v_sub.household_id is not null and v_sub.household_id <> p_household_id then
    raise exception 'This Apple subscription is already linked to another household';
  end if;
  if v_sub.owner_user_id is not null and v_sub.owner_user_id <> p_owner_user_id then
    raise exception 'This Apple subscription is linked to another account';
  end if;

  -- B5: 已撤销/已过期订阅不可通过旧 JWS 重新激活（退款后重放防护；verify-apple-receipt 同款检查，此处纵深防御）。
  if v_sub.status in ('revoked', 'expired') then
    raise exception 'Subscription is revoked or expired and cannot be reactivated';
  end if;

  update public.subscriptions
    set household_id = coalesce(household_id, p_household_id),
        plan = p_plan,
        expires_at = p_expires_at,
        status = 'active',
        environment = p_environment,
        last_transaction_id = p_last_transaction_id,
        owner_user_id = coalesce(owner_user_id, p_owner_user_id),
        updated_at = now()
    where id = v_sub.id;

  insert into public.subscription_households (subscription_id, household_id)
  values (v_sub.id, p_household_id)
  on conflict do nothing;

  perform public.set_household_plus(p_household_id, p_plan, p_owner_member_id, p_expires_at);
end;
$$;
revoke all on function public.register_apple_subscription(uuid, text, text, timestamptz, text, text, uuid, uuid) from public;
grant execute on function public.register_apple_subscription(uuid, text, text, timestamptz, text, text, uuid, uuid) to service_role;

-- 0054: Keep orphaned Apple subscription recovery fail-closed at the DB layer.
-- The Edge Function may reclaim a subscription only after the original auth
-- user and every household binding were deleted. This RPC remains the final
-- serialized guard against races and future callers.

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

  -- The conflict update takes the unique-row lock. Concurrent claims are
  -- serialized, and the second caller observes the first caller's new owner.
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

  -- A NULL owner is reclaimable only when no household coverage survives.
  -- This protects legacy rows and preserves the Edge Function's orphan rule.
  if v_sub.owner_user_id is null and (
    v_sub.household_id is not null or exists (
      select 1 from public.subscription_households sh where sh.subscription_id = v_sub.id
    )
  ) then
    raise exception 'This Apple subscription still has an existing household binding';
  end if;

  if v_sub.status in ('revoked', 'expired', 'canceled') then
    raise exception 'Subscription is revoked, expired, or canceled and cannot be reactivated';
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

revoke all on function public.register_apple_subscription(uuid, text, text, timestamptz, text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.register_apple_subscription(uuid, text, text, timestamptz, text, text, uuid, uuid)
  to service_role;

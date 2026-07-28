-- 0012: Bind each Apple subscription permanently to one TaskKin household.
-- A signed Apple transaction proves that a purchase occurred, but it does not
-- authorize a client to choose an arbitrary household. The Edge Function
-- authenticates the caller and this function prevents an original transaction
-- from being moved to a different household on a later request.

alter table public.subscriptions
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null;

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

  -- The no-op update takes the unique-row lock, including when two receipt
  -- verifications race. It never changes the household binding.
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

  if v_sub.household_id <> p_household_id then
    raise exception 'This Apple subscription is already linked to another household';
  end if;
  if v_sub.owner_user_id is not null and v_sub.owner_user_id <> p_owner_user_id then
    raise exception 'This Apple subscription is linked to another account';
  end if;

  update public.subscriptions
    set plan = p_plan,
        expires_at = p_expires_at,
        status = 'active',
        environment = p_environment,
        last_transaction_id = p_last_transaction_id,
        owner_user_id = coalesce(owner_user_id, p_owner_user_id),
        updated_at = now()
    where id = v_sub.id;

  perform public.set_household_plus(p_household_id, p_plan, p_owner_member_id, p_expires_at);
end;
$$;

revoke all on function public.register_apple_subscription(uuid, text, text, timestamptz, text, text, uuid, uuid) from public;
grant execute on function public.register_apple_subscription(uuid, text, text, timestamptz, text, text, uuid, uuid) to service_role;

-- 0013: Family Plus multi-household workspaces (up to three coordinator homes).
--
-- The original MVP selected an arbitrary membership as the current household.
-- This migration makes the active workspace explicit and maps one Apple
-- subscription to each household that it covers.

create table if not exists public.user_household_context (
  user_id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  updated_at timestamptz not null default now()
);
alter table public.user_household_context enable row level security;
revoke all on public.user_household_context from anon, authenticated;

-- A subscription's canonical household may be deleted while it still covers a
-- second or third household, so keep the canonical reference optional.
alter table public.subscriptions alter column household_id drop not null;
alter table public.subscriptions drop constraint if exists subscriptions_household_id_fkey;
alter table public.subscriptions
  add constraint subscriptions_household_id_fkey
  foreign key (household_id) references public.households(id) on delete set null;

create table if not exists public.subscription_households (
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (subscription_id, household_id)
);
alter table public.subscription_households enable row level security;
revoke all on public.subscription_households from anon, authenticated;

-- Preserve coverage for subscriptions registered before this migration.
insert into public.subscription_households (subscription_id, household_id)
select id, household_id from public.subscriptions where household_id is not null
on conflict do nothing;

create or replace function public.current_household_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (
      select c.household_id
      from public.user_household_context c
      join public.members m on m.household_id = c.household_id
      where c.user_id = auth.uid()
        and m.user_id = auth.uid()
        and m.invite_status = 'active'
    ),
    (
      select household_id
      from public.members
      where user_id = auth.uid() and invite_status = 'active'
      order by created_at asc
      limit 1
    )
  );
$$;

create or replace function public.current_member_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id
  from public.members
  where user_id = auth.uid()
    and household_id = public.current_household_id()
    and invite_status = 'active'
  limit 1;
$$;

create or replace function public.current_member_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role
  from public.members
  where user_id = auth.uid()
    and household_id = public.current_household_id()
    and invite_status = 'active'
  limit 1;
$$;

create or replace function public.list_my_households()
returns table (
  id uuid,
  name text,
  care_recipient_label text,
  role text,
  plus_plan text,
  plus_until timestamptz,
  is_active boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select h.id, h.name, h.care_recipient_label, m.role, h.plus_plan, h.plus_until,
         h.id = public.current_household_id() as is_active
  from public.members m
  join public.households h on h.id = m.household_id
  where m.user_id = auth.uid() and m.invite_status = 'active'
  order by h.created_at asc;
$$;
revoke all on function public.list_my_households() from public;
grant execute on function public.list_my_households() to authenticated;

create or replace function public.set_active_household(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1 from public.members
    where household_id = p_household_id and user_id = auth.uid() and invite_status = 'active'
  ) then
    raise exception 'You are not an active member of this household';
  end if;
  insert into public.user_household_context (user_id, household_id, updated_at)
  values (auth.uid(), p_household_id, now())
  on conflict (user_id) do update
    set household_id = excluded.household_id, updated_at = now();
end;
$$;
revoke all on function public.set_active_household(uuid) from public;
grant execute on function public.set_active_household(uuid) to authenticated;

-- Re-registering an active Apple transaction may refresh its expiry, but can
-- never move it to another household/account. Coverage is expanded only by
-- creating a household as the subscription owner.
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

-- Subscription notifications update every linked household, not only the one
-- used for the original purchase.
create or replace function public.sync_subscription_by_transaction(
  p_original_transaction_id text,
  p_plan text,
  p_expires_at timestamptz,
  p_status text,
  p_last_transaction_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.subscriptions%rowtype;
begin
  select * into v_sub from public.subscriptions where original_transaction_id = p_original_transaction_id;
  if not found then return; end if;

  update public.subscriptions
    set plan = p_plan,
        expires_at = p_expires_at,
        status = p_status,
        last_transaction_id = p_last_transaction_id,
        updated_at = now()
    where id = v_sub.id;

  if p_status = 'active' and p_expires_at is not null and p_expires_at > now() then
    update public.households h
      set plus_plan = p_plan,
          plus_until = p_expires_at,
          plus_owner_id = m.id
      from public.subscription_households sh
      join public.members m on m.household_id = sh.household_id
      where sh.subscription_id = v_sub.id
        and h.id = sh.household_id
        and m.user_id = v_sub.owner_user_id
        and m.role = 'coordinator'
        and m.invite_status = 'active';
  else
    update public.households h
      set plus_plan = 'free', plus_until = null, plus_owner_id = null
      from public.subscription_households sh
      where sh.subscription_id = v_sub.id and h.id = sh.household_id;
  end if;
end;
$$;
revoke all on function public.sync_subscription_by_transaction(text, text, timestamptz, text, text) from public;
grant execute on function public.sync_subscription_by_transaction(text, text, timestamptz, text, text) to service_role;

-- Creating a new household activates it and extends the caller's active
-- subscription coverage, up to the existing Free/Plus server-side limit.
create or replace function public.create_household(
  p_household_name text,
  p_timezone text,
  p_care_recipient_label text,
  p_member_name text,
  p_member_relation text,
  p_member_timezone text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_member_id uuid;
  v_existing int;
  v_has_plus boolean;
  v_limit int;
  v_sub public.subscriptions%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select count(*) into v_existing
    from public.members
    where user_id = auth.uid() and role = 'coordinator' and invite_status = 'active';
  select exists (
    select 1
    from public.subscriptions
    where owner_user_id = auth.uid()
      and status = 'active'
      and expires_at > now()
  ) into v_has_plus;
  v_existing := coalesce(v_existing, 0);
  v_limit := case when coalesce(v_has_plus, false) then 3 else 1 end;
  if v_existing >= v_limit then
    raise exception 'Household limit reached (%) for your plan. Upgrade to Family Plus for more.', v_limit;
  end if;

  insert into public.households (name, timezone, care_recipient_label, invite_expires_at, created_by)
  values (p_household_name, p_timezone, p_care_recipient_label, now() + interval '48 hours', auth.uid())
  returning id into v_household_id;
  insert into public.members (household_id, user_id, name, relation, role, timezone, invite_status)
  values (v_household_id, auth.uid(), p_member_name, p_member_relation, 'coordinator', p_member_timezone, 'active')
  returning id into v_member_id;
  insert into public.notification_preferences (household_id, member_id) values (v_household_id, v_member_id);
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (v_household_id, v_member_id, 'household.created', 'household', v_household_id::text,
          'Created household with non-PHI MVP mode enabled.');

  select * into v_sub
    from public.subscriptions
    where owner_user_id = auth.uid() and status = 'active' and expires_at > now()
    order by expires_at desc
    limit 1;
  if found then
    insert into public.subscription_households (subscription_id, household_id)
    values (v_sub.id, v_household_id)
    on conflict do nothing;
    perform public.set_household_plus(v_household_id, v_sub.plan, v_member_id, v_sub.expires_at);
  end if;

  insert into public.user_household_context (user_id, household_id, updated_at)
  values (auth.uid(), v_household_id, now())
  on conflict (user_id) do update set household_id = excluded.household_id, updated_at = now();
  return v_household_id;
end;
$$;

drop function if exists public.accept_invite(uuid, text);
create or replace function public.accept_invite(
  p_invite_token uuid,
  p_display_name text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv record;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select id, member_id, household_id, expires_at, accepted_at
    into v_inv from public.invites where token = p_invite_token for update;
  if not found then raise exception 'Invalid invite token'; end if;
  if v_inv.accepted_at is not null then raise exception 'Invite has already been used'; end if;
  if v_inv.expires_at <= now() then raise exception 'Invite has expired'; end if;

  update public.invites set accepted_at = now() where id = v_inv.id;
  update public.members
    set user_id = auth.uid(), invite_status = 'active', name = coalesce(p_display_name, name)
    where id = v_inv.member_id and invite_status = 'pending' and user_id is null;
  if not found then raise exception 'Invite is no longer available'; end if;

  insert into public.user_household_context (user_id, household_id, updated_at)
  values (auth.uid(), v_inv.household_id, now())
  on conflict (user_id) do update set household_id = excluded.household_id, updated_at = now();
  return v_inv.household_id;
end;
$$;
revoke all on function public.accept_invite(uuid, text) from public;
grant execute on function public.accept_invite(uuid, text) to authenticated;

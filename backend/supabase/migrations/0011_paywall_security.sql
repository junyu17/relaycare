-- 0011: 付费墙安全加固（P0）+ 订阅状态表（P1 Server Notifications V2）
--
-- P0-1: 收回 authenticated 对 set_household_plus 的执行权 -> 仅 service_role（校验 Edge Function）可调。
--       客户端无法再直接升级自己。
-- P0-2: set_household_plus 改收显式 p_plus_until（Apple 真实到期时间），不再硬编码 365 天。
-- P1:   subscriptions 表记录 original_transaction_id <-> household 映射，供 Server Notifications V2 回调定位家庭。

-- ============ P0-1: 收回 authenticated 执行权 ============
revoke execute on function public.set_household_plus(uuid, text, uuid) from authenticated;

-- ============ P0-2: 重写 set_household_plus（显式到期时间）============
drop function if exists public.set_household_plus(uuid, text, uuid);
create or replace function public.set_household_plus(
  p_household_id uuid,
  p_plan text,
  p_owner_member_id uuid,
  p_plus_until timestamptz default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_plan not in ('free','monthly','yearly') then
    raise exception 'Invalid plan';
  end if;
  update public.households
    set plus_plan = p_plan,
        plus_until = case when p_plan = 'free' then null else p_plus_until end,
        plus_owner_id = case
          when p_plan = 'free' then null
          when p_owner_member_id is not null then p_owner_member_id
          else plus_owner_id
        end
    where id = p_household_id;
end;
$$;
revoke all on function public.set_household_plus(uuid, text, uuid, timestamptz) from public;
grant execute on function public.set_household_plus(uuid, text, uuid, timestamptz) to service_role;

-- ============ P1: subscriptions 表（Apple 交易 <-> 家庭映射）============
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  original_transaction_id text not null,
  plan text not null check (plan in ('monthly','yearly')),
  expires_at timestamptz,
  status text not null default 'active' check (status in ('active','expired','revoked','canceled')),
  environment text,
  last_transaction_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (original_transaction_id)
);
create index if not exists subscriptions_household_idx on public.subscriptions (household_id);
-- RLS：客户端不可读写（仅校验 Edge Function 用 service_role 访问）。
alter table public.subscriptions enable row level security;
revoke all on public.subscriptions from authenticated, anon;
grant all on public.subscriptions to service_role;

-- upsert 订阅记录 + 同步家庭 entitlement（供 Edge Function 调用）。
create or replace function public.upsert_subscription(
  p_household_id uuid,
  p_original_transaction_id text,
  p_plan text,
  p_expires_at timestamptz,
  p_status text,
  p_environment text,
  p_last_transaction_id text,
  p_owner_member_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions (household_id, original_transaction_id, plan, expires_at, status, environment, last_transaction_id)
  values (p_household_id, p_original_transaction_id, p_plan, p_expires_at, p_status, p_environment, p_last_transaction_id)
  on conflict (original_transaction_id) do update
    set household_id = excluded.household_id,
        plan = excluded.plan,
        expires_at = excluded.expires_at,
        status = excluded.status,
        environment = excluded.environment,
        last_transaction_id = excluded.last_transaction_id,
        updated_at = now();
  -- 同步家庭 entitlement：active 且未过期才给 Plus，否则 free。
  if p_status = 'active' and p_expires_at is not null and p_expires_at > now() then
    perform public.set_household_plus(p_household_id, p_plan, p_owner_member_id, p_expires_at);
  else
    perform public.set_household_plus(p_household_id, 'free', null, null);
  end if;
end;
$$;
revoke all on function public.upsert_subscription(uuid, text, text, timestamptz, text, text, text, uuid) from public;
grant execute on function public.upsert_subscription(uuid, text, text, timestamptz, text, text, text, uuid) to service_role;

-- Server Notifications V2 按 original_transaction_id 反查家庭并更新。
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
declare v_sub public.subscriptions%rowtype;
begin
  select * into v_sub from public.subscriptions where original_transaction_id = p_original_transaction_id;
  if not found then
    return; -- 未知交易（可能是别的 app 或未在本系统登记），忽略。
  end if;
  update public.subscriptions
    set plan = p_plan,
        expires_at = p_expires_at,
        status = p_status,
        last_transaction_id = p_last_transaction_id,
        updated_at = now()
    where id = v_sub.id;
  if p_status = 'active' and p_expires_at is not null and p_expires_at > now() then
    perform public.set_household_plus(v_sub.household_id, p_plan, null, p_expires_at);
  else
    perform public.set_household_plus(v_sub.household_id, 'free', null, null);
  end if;
end;
$$;
revoke all on function public.sync_subscription_by_transaction(text, text, timestamptz, text, text) from public;
grant execute on function public.sync_subscription_by_transaction(text, text, timestamptz, text, text) to service_role;

-- ============ P1: 删除账号及家庭数据（Apple 5.1.1 应用内删除）============
-- 由 delete-account Edge Function（service role）调用：删该用户协调的家庭（级联）+ 其余成员记录。
create or replace function public.delete_account_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 删除该用户作为协调人的家庭（级联删除家庭全部数据）。
  delete from public.households
    where id in (
      select household_id from public.members
        where user_id = p_user_id and role = 'coordinator' and invite_status = 'active'
    );
  -- 删除该用户在其他家庭中的成员记录（非协调人）。
  delete from public.members where user_id = p_user_id;
end;
$$;
revoke all on function public.delete_account_data(uuid) from public;
grant execute on function public.delete_account_data(uuid) to service_role;

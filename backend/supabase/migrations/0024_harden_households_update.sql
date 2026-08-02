-- 0024: 阻断 authenticated 直接写 households / members（防免费升级与身份接管）
--
-- 背景：0005:66-68 households update policy 与 0022:12 members update policy 均无列限制，
-- coordinator 可经 REST 直接 PATCH/INSERT 带 plus_plan/plus_until/plus_owner_id（免费升级
-- Family Plus，绕过 set_household_plus 的 service_role 边界）或 role/user_id/invite_status
-- （身份接管/绕过 update_member_role 审计）；0002:32 households insert by creator 还可绕过
-- create_household 的家庭数配额（security_review 阻断项）。
-- 客户端（src/）对 households/members 仅有 SELECT（db.ts:256），全部写路径均经
-- security definer RPC（create_household/accept_invite/join_by_code/remove_member/
-- update_member_role/update_my_name/set_household_plus/sync_subscription_by_transaction 等，
-- current_user=postgres 不受影响），service_role 为超级权限不受影响，故可安全撤销表级写权限。

-- 1) households：撤销客户端 INSERT/UPDATE。
revoke insert, update on table public.households from anon, authenticated;

-- 2) members：撤销客户端 INSERT/UPDATE。
revoke insert, update on table public.members from anon, authenticated;

-- 3) 纵深防御：即使未来恢复客户端表级权限，付费列/成员关键列的直接修改仍被拒绝。
create or replace function public.guard_household_paid_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if (tg_op = 'INSERT')
       or new.plus_plan is distinct from old.plus_plan
       or new.plus_until is distinct from old.plus_until
       or new.plus_owner_id is distinct from old.plus_owner_id
    then
      if new.plus_plan is distinct from 'free'
         or new.plus_until is not null
         or new.plus_owner_id is not null
      then
        raise exception 'Direct write of paid entitlement columns is not permitted';
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_household_paid_columns on public.households;
create trigger trg_guard_household_paid_columns
  before insert or update on public.households
  for each row execute function public.guard_household_paid_columns();

create or replace function public.guard_member_key_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.role is distinct from old.role
       or new.user_id is distinct from old.user_id
       or new.invite_status is distinct from old.invite_status
    then
      raise exception 'Direct update of member role/identity columns is not permitted';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_member_key_columns on public.members;
create trigger trg_guard_member_key_columns
  before update on public.members
  for each row execute function public.guard_member_key_columns();

revoke all on function public.guard_household_paid_columns() from public;
revoke all on function public.guard_member_key_columns() from public;

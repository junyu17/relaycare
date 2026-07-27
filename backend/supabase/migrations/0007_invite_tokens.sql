-- 0007: invite token security + storage orphan cleanup helper
--
-- 问题（评审 I3）：旧 accept_invite(p_member_id) 仅凭 member UUID 即可加入家庭，
-- 而 member UUID 通过 members API 对同家庭所有成员可见（含 viewer），任何家庭成员
-- 都能冒用 pending 邀请。本迁移引入独立 invites 表，token 不经 API 暴露
-- （无 select 策略，RLS 完全锁定），创建/接受都走 security definer RPC。

-- ============ invites 表（token 不对客户端可读） ============
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  token uuid not null default gen_random_uuid(),
  expires_at timestamptz not null default (now() + interval '48 hours'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (member_id)
);
create unique index if not exists invites_token_idx on public.invites (token);
create index if not exists invites_member_idx on public.invites (member_id);

-- RLS 启用且不定义任何 select/update/delete 策略 -> 客户端完全无法读取或修改 token。
-- 所有访问走下面的 security definer RPC。
alter table public.invites enable row level security;

-- ============ create_invite：协调人创建邀请，返回 token（不经 API 可读） ============
create or replace function public.create_invite(p_member_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_token uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select household_id into v_household_id
    from public.members
    where id = p_member_id
      and household_id = public.current_household_id();

  if not found then
    raise exception 'Member not found in your household';
  end if;
  if not public.is_coordinator() then
    raise exception 'Only a coordinator can create invites';
  end if;

  insert into public.invites (household_id, member_id)
    values (v_household_id, p_member_id)
    on conflict (member_id) do update
      set expires_at = now() + interval '48 hours',
          accepted_at = null
    returning token into v_token;

  return v_token;
end;
$$;

revoke all on function public.create_invite(uuid) from public;
grant execute on function public.create_invite(uuid) to authenticated;

-- ============ 重写 accept_invite：凭 token 加入 ============
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
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select id, member_id, household_id, expires_at, accepted_at
    into v_inv
    from public.invites
    where token = p_invite_token
    for update;

  if not found then
    raise exception 'Invalid invite token';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'Invite has already been used';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'Invite has expired';
  end if;

  -- 防重放：先标记已接受，再绑定用户。
  update public.invites set accepted_at = now() where id = v_inv.id;

  update public.members
    set user_id = auth.uid(),
        invite_status = 'active',
        name = coalesce(p_display_name, name)
    where id = v_inv.member_id
      and invite_status = 'pending'
      and user_id is null;

  return v_inv.household_id;
end;
$$;

revoke all on function public.accept_invite(uuid, text) from public;
grant execute on function public.accept_invite(uuid, text) to authenticated;

-- ============ Realtime：无需订阅 invites（仅 RPC 读取） ============

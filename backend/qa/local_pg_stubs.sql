-- ============================================================================
-- 本地 Postgres 测试专用：Supabase 平台对象的最小替身（auth / storage / 角色 / realtime）
--
-- 只由 backend/qa/local_pg.sh 加载到它自己创建的本地库（backend/.localpg），
-- 绝不能放进 backend/supabase/migrations/，也不要在任何 Supabase 项目上执行：
-- 线上这些对象由平台（GoTrue / Storage / Realtime）创建和维护。
--
-- 列名与类型按 supabase/auth 仓库的 migrations 核对（2026-10-02，master）：
--   users.is_anonymous            ← 20240214120130_add_is_anonymous_column
--   identities(provider_id, provider, email generated) ← 20231117164230 / 20221215195800
--   sessions.refreshed_at 是 timestamp WITHOUT time zone ← 20231027141322
--   refresh_tokens.user_id 是 varchar(255)，没有指向 users 的外键 ← 00_init_auth_schema
-- auth.uid()/auth.role()/auth.jwt() 与 GoTrue 的实现相同：读 request.jwt.claims。
-- ============================================================================

-- ---------- 角色（与 Supabase 同名；service_role 绕过 RLS）----------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- Supabase 的默认权限：postgres 在 public 下新建的表/函数/序列自动授予三个 API 角色。
-- 迁移里的 revoke 正是针对这一点写的，所以本地必须复现，测试才能发现漏掉的 revoke。
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- ---------- auth schema ----------
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key,
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  confirmation_token varchar(255),
  confirmation_sent_at timestamptz,
  recovery_token varchar(255),
  recovery_sent_at timestamptz,
  email_change_token_new varchar(255),
  email_change varchar(255),
  email_change_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_super_admin boolean,
  created_at timestamptz,
  updated_at timestamptz,
  phone text,
  phone_confirmed_at timestamptz,
  banned_until timestamptz,
  is_sso_user boolean not null default false,
  deleted_at timestamptz,
  is_anonymous boolean not null default false
);

create table if not exists auth.identities (
  provider_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  identity_data jsonb not null,
  provider text not null,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  email text generated always as (lower(identity_data ->> 'email')) stored,
  id uuid primary key default gen_random_uuid(),
  constraint identities_provider_id_provider_unique unique (provider_id, provider)
);

create table if not exists auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz,
  updated_at timestamptz,
  not_after timestamptz,
  refreshed_at timestamp without time zone,
  user_agent text,
  ip inet
);

create table if not exists auth.refresh_tokens (
  instance_id uuid,
  id bigserial primary key,
  token varchar(255),
  user_id varchar(255),
  revoked boolean,
  created_at timestamptz,
  updated_at timestamptz,
  parent varchar(255),
  session_id uuid references auth.sessions(id) on delete cascade
);

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;

-- ---------- storage schema（0004/0005 的 bucket 与 policy 需要）----------
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  public boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  metadata jsonb
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;

-- ---------- realtime ----------
-- 本地 wal_level 不是 logical，建 publication 只会给出 WARNING；迁移里的
-- "alter publication supabase_realtime add table" 照常执行，测试据此核对发布范围。
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

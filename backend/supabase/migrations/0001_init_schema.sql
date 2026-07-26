-- TaskKin Care MVP - initial schema for Supabase (Postgres)
-- 设计要点：
--   1. 所有业务表带 household_id，RLS 按家庭隔离（家庭 A 看不到家庭 B 的数据）。
--   2. members.user_id 关联 auth.users；为空表示待邀请（pending）。
--   3. 角色权限（coordinator/caregiver/viewer）在 app 层用 hasPermission 强制；
--      DB 层只做"家庭隔离"，避免 RLS 策略过于复杂（MVP 取舍，见 backend/README）。
--   4. 创建家庭、接受邀请用 security-definer RPC 绕过 RLS 完成首条记录写入。

create extension if not exists "pgcrypto";

-- ============ Households ============
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/Los_Angeles',
  invite_expires_at timestamptz not null,
  care_recipient_label text not null default 'Care recipient',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ============ Members ============
create table public.members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  relation text not null default '',
  role text not null check (role in ('coordinator', 'caregiver', 'viewer')),
  timezone text not null default 'America/Los_Angeles',
  availability text not null default '',
  invite_status text not null default 'active' check (invite_status in ('active', 'pending')),
  invite_expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (household_id, user_id)
);
create index on public.members (household_id);
create index on public.members (user_id);

-- ============ Role definitions ============
create table public.role_definitions (
  role text primary key check (role in ('coordinator', 'caregiver', 'viewer')),
  label text not null,
  permissions jsonb not null default '[]'::jsonb
);

-- ============ Notification preferences ============
create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  email_enabled boolean not null default true,
  push_enabled boolean not null default true,
  quiet_hours_start text not null default '22:00',
  quiet_hours_end text not null default '07:00',
  task_digest boolean not null default true,
  critical_due_alerts boolean not null default true,
  unique (member_id)
);
create index on public.notification_preferences (household_id);

-- ============ Role notifications ============
create table public.role_notifications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  audience text not null,
  severity text not null check (severity in ('info', 'critical')),
  title_key text not null,
  body_key text not null,
  values jsonb not null default '{}'::jsonb,
  entity_type text not null,
  entity_id text not null,
  created_at timestamptz not null default now()
);
create index on public.role_notifications (household_id);

-- ============ Tasks ============
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null,
  expected_minutes integer not null default 0,
  due_at timestamptz,
  priority text not null default 'normal' check (priority in ('normal', 'critical')),
  status text not null default 'open' check (status in ('open', 'claimed', 'handoff_requested', 'rejected', 'completed')),
  owner_id uuid references public.members(id) on delete set null,
  requested_by_id uuid not null references public.members(id),
  event_id uuid,
  document_id uuid,
  subtasks jsonb not null default '[]'::jsonb,
  proof text,
  rejection_reason text,
  handoff_to_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.tasks (household_id);
create index on public.tasks (status);

-- ============ Care events ============
create table public.care_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  type text not null check (type in ('appointment', 'transport', 'visit', 'reminder', 'document')),
  title text not null,
  starts_at timestamptz,
  location text not null default '',
  owner_id uuid references public.members(id) on delete set null,
  task_id uuid,
  document_id uuid
);
create index on public.care_events (household_id);

-- ============ Documents ============
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  uploaded_by_id uuid not null references public.members(id),
  uploaded_at timestamptz not null default now(),
  status text not null default 'uploaded' check (status in ('uploaded', 'pending_confirmation', 'confirmed')),
  contains_phi boolean not null default false,
  confidence double precision not null default 0,
  source text not null check (source in ('manual_upload', 'sample')),
  suggested_action text
);
create index on public.documents (household_id);

-- ============ Audit events ============
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  actor_id uuid not null references public.members(id),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index on public.audit_events (household_id);
create index on public.audit_events (created_at desc);

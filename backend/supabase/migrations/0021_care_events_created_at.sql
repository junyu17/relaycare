-- 0021: add creation timestamp to timeline events for stable ordering and auditability.
-- Timeline display remains ordered by starts_at; created_at records insertion order.

alter table public.care_events
  add column if not exists created_at timestamptz not null default now();

create index if not exists care_events_household_starts_idx
  on public.care_events (household_id, starts_at asc);

create index if not exists care_events_household_created_idx
  on public.care_events (household_id, created_at desc);

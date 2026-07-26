-- TaskKin Care MVP - role-aware RLS hardening
--
-- 0002 isolated households but allowed every authenticated household member to
-- mutate most rows. This migration makes the three MVP roles enforceable at
-- the database boundary as well as in the app UI.

create or replace function public.current_member_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id
  from public.members
  where user_id = auth.uid() and invite_status = 'active'
  limit 1;
$$;

create or replace function public.current_member_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role
  from public.members
  where user_id = auth.uid() and invite_status = 'active'
  limit 1;
$$;

create or replace function public.is_coordinator()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_member_role() = 'coordinator';
$$;

create or replace function public.can_coordinate_work()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_member_role() in ('coordinator', 'caregiver');
$$;

-- Replace household-only policies with least-privilege role policies.
drop policy if exists "households: update own" on public.households;
drop policy if exists "members: insert household" on public.members;
drop policy if exists "members: update household" on public.members;
drop policy if exists "np: household all" on public.notification_preferences;
drop policy if exists "rn: household select" on public.role_notifications;
drop policy if exists "rn: household insert" on public.role_notifications;
drop policy if exists "tasks: household all" on public.tasks;
drop policy if exists "events: household all" on public.care_events;
drop policy if exists "documents: household all" on public.documents;
drop policy if exists "audit: household select" on public.audit_events;
drop policy if exists "audit: household insert" on public.audit_events;

create policy "households: update coordinator" on public.households
  for update using (id = public.current_household_id() and public.is_coordinator())
  with check (id = public.current_household_id() and public.is_coordinator());

create policy "members: insert coordinator" on public.members
  for insert with check (
    household_id = public.current_household_id()
    and public.is_coordinator()
  );
create policy "members: update coordinator" on public.members
  for update using (
    household_id = public.current_household_id()
    and public.is_coordinator()
    and id <> public.current_member_id()
  ) with check (
    household_id = public.current_household_id()
    and public.is_coordinator()
  );

create policy "preferences: select own or coordinator" on public.notification_preferences
  for select using (
    household_id = public.current_household_id()
    and (public.is_coordinator() or member_id = public.current_member_id())
  );
create policy "preferences: insert coordinator" on public.notification_preferences
  for insert with check (
    household_id = public.current_household_id()
    and public.is_coordinator()
  );
create policy "preferences: update own or coordinator" on public.notification_preferences
  for update using (
    household_id = public.current_household_id()
    and (public.is_coordinator() or member_id = public.current_member_id())
  ) with check (
    household_id = public.current_household_id()
    and (public.is_coordinator() or member_id = public.current_member_id())
  );

create policy "notifications: select audience" on public.role_notifications
  for select using (
    household_id = public.current_household_id()
    and (audience = 'all' or audience = public.current_member_role())
  );
create policy "notifications: insert workers" on public.role_notifications
  for insert with check (
    household_id = public.current_household_id()
    and public.can_coordinate_work()
  );

create policy "tasks: select workers" on public.tasks
  for select using (
    household_id = public.current_household_id()
    and public.can_coordinate_work()
  );
create policy "tasks: insert workers" on public.tasks
  for insert with check (
    household_id = public.current_household_id()
    and public.can_coordinate_work()
    and requested_by_id = public.current_member_id()
    and status = 'open'
  );
create policy "tasks: update role owner or handoff target" on public.tasks
  for update using (
    household_id = public.current_household_id()
    and (
      public.is_coordinator()
      or (
        public.current_member_role() = 'caregiver'
        and (
          owner_id = public.current_member_id()
          or (owner_id is null and status in ('open', 'rejected'))
          or handoff_to_id = public.current_member_id()
        )
      )
    )
  ) with check (
    household_id = public.current_household_id()
    and (
      public.is_coordinator()
      or (
        public.current_member_role() = 'caregiver'
        and (
          owner_id = public.current_member_id()
          or (status = 'rejected' and owner_id is null)
        )
      )
    )
  );

create policy "events: select household" on public.care_events
  for select using (household_id = public.current_household_id());
create policy "events: insert workers" on public.care_events
  for insert with check (
    household_id = public.current_household_id()
    and public.can_coordinate_work()
    and owner_id = public.current_member_id()
  );

create policy "documents: select workers" on public.documents
  for select using (
    household_id = public.current_household_id()
    and public.can_coordinate_work()
  );
create policy "documents: insert workers" on public.documents
  for insert with check (
    household_id = public.current_household_id()
    and public.can_coordinate_work()
    and uploaded_by_id = public.current_member_id()
  );
create policy "documents: update workers" on public.documents
  for update using (
    household_id = public.current_household_id()
    and public.can_coordinate_work()
  ) with check (
    household_id = public.current_household_id()
    and public.can_coordinate_work()
  );

create policy "audit: select coordinator" on public.audit_events
  for select using (
    household_id = public.current_household_id()
    and public.is_coordinator()
  );
create policy "audit: insert workers as self" on public.audit_events
  for insert with check (
    household_id = public.current_household_id()
    and public.can_coordinate_work()
    and actor_id = public.current_member_id()
  );

-- Keep documents private to workers. This matches the Documents tab and avoids
-- exposing files to a Viewer through a signed URL or storage API call.
drop policy if exists "documents storage: household read" on storage.objects;
drop policy if exists "documents storage: household write" on storage.objects;
drop policy if exists "documents storage: household delete" on storage.objects;
create policy "documents storage: workers read" on storage.objects
  for select using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_household_id()::text
    and public.can_coordinate_work()
  );
create policy "documents storage: workers write" on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_household_id()::text
    and public.can_coordinate_work()
  );
create policy "documents storage: coordinators delete" on storage.objects
  for delete using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_household_id()::text
    and public.is_coordinator()
  );

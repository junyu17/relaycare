-- 0014_auth_email_autoconfirm.sql
-- Production unblock: Brevo/Supabase confirmation emails are not reliably
-- delivered yet. Until sender/domain deliverability is fixed, do not block
-- password sign-in on email confirmation.

create or replace function public.relaycare_autoconfirm_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_confirmed_at is null then
    new.email_confirmed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists relaycare_autoconfirm_email on auth.users;
create trigger relaycare_autoconfirm_email
before insert on auth.users
for each row
execute function public.relaycare_autoconfirm_email();

update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now()),
    updated_at = now()
where email_confirmed_at is null;

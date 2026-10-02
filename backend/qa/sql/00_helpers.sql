-- ============================================================================
-- 本地 SQL 测试的辅助函数（qa schema）。只由 backend/qa/local_pg.sh 加载到本地测试库，
-- 不属于任何迁移，也不要在 Supabase 项目上执行。
--
-- qa.call(uid, sql, role) 模拟一次 PostgREST 调用：设置 request.jwt.claims、切换到 API 角色、
-- 执行一条返回单值的 SQL；出错时只回滚这一次调用的写入（与 PostgREST 一次请求一个事务一致），
-- 并返回 sqlstate / message / hint，方便断言 1.9 能看到的英文 message 和 1.10 用的 hint。
-- ============================================================================

create schema if not exists qa;

drop type if exists qa.result cascade;
create type qa.result as (ok boolean, value text, state text, message text, hint text);

create or replace function qa.call(p_uid uuid, p_sql text, p_role text default 'authenticated')
returns qa.result
language plpgsql
as $$
declare
  r qa.result;
begin
  perform set_config(
    'request.jwt.claims',
    case
      when p_uid is null then json_build_object('role', p_role)::text
      else json_build_object('sub', p_uid, 'role', p_role)::text
    end,
    true
  );
  begin
    execute format('set local role %I', p_role);
    execute p_sql into r.value;
    reset role;
    r.ok := true;
  exception when others then
    get stacked diagnostics r.state = returned_sqlstate, r.message = message_text, r.hint = pg_exception_hint;
    r.ok := false;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end;
$$;

-- 断言
create or replace function qa.check(p_cond boolean, p_msg text)
returns void
language plpgsql
as $$
begin
  if p_cond is not true then
    raise exception 'FAIL: %', p_msg;
  end if;
end;
$$;

create or replace function qa.ok(r qa.result, p_msg text)
returns text
language plpgsql
as $$
begin
  if not r.ok then
    raise exception 'FAIL: % (sqlstate %, message %, hint %)', p_msg, r.state, r.message, r.hint;
  end if;
  return r.value;
end;
$$;

create or replace function qa.err(r qa.result, p_hint text, p_msg text, p_message text default null)
returns void
language plpgsql
as $$
begin
  if r.ok then
    raise exception 'FAIL: % (expected error hint %, got success value %)', p_msg, p_hint, r.value;
  end if;
  if p_hint is not null and r.hint is distinct from p_hint then
    raise exception 'FAIL: % (expected hint %, got hint % / message %)', p_msg, p_hint, r.hint, r.message;
  end if;
  if p_message is not null and r.message is distinct from p_message then
    raise exception 'FAIL: % (expected message "%", got "%")', p_msg, p_message, r.message;
  end if;
end;
$$;

create or replace function qa.denied(r qa.result, p_msg text)
returns void
language plpgsql
as $$
begin
  if r.ok or r.state <> '42501' then
    raise exception 'FAIL: % (expected permission denied 42501, got ok=% state=% message=%)', p_msg, r.ok, r.state, r.message;
  end if;
end;
$$;

create or replace function qa.pass(p_msg text)
returns void
language plpgsql
as $$
begin
  raise notice 'PASS %', p_msg;
end;
$$;

-- 造一个 auth 用户。
--   anonymous                   signInAnonymously
--   apple                       用 Apple 登录（或匿名后 linkIdentity，且 GoTrue 把 is_anonymous 改成了 false）
--   anonymous_apple             linkIdentity 之后 is_anonymous 没变（方案 risks 里的设计前提）
--   email_password              老的邮箱 + 密码账号
--   email_no_password           匿名用户 PUT /user 只设邮箱（自动确认后 is_anonymous=false，但没有密码）
--   anonymous_email_no_password 同上但 is_anonymous 仍为 true
create or replace function qa.user(p_kind text default 'anonymous')
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if p_kind not in (
    'anonymous', 'apple', 'anonymous_apple', 'email_password', 'email_no_password', 'anonymous_email_no_password'
  ) then
    raise exception 'qa.user: unknown kind %', p_kind;
  end if;
  insert into auth.users (
    id, aud, role, email, encrypted_password, created_at, updated_at, last_sign_in_at,
    raw_app_meta_data, raw_user_meta_data, is_anonymous
  ) values (
    v_id, 'authenticated', 'authenticated',
    case when p_kind like '%email%' then v_id::text || '@qa.invalid' end,
    case when p_kind = 'email_password' then 'qa-placeholder-not-a-real-hash' else '' end,
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb,
    p_kind in ('anonymous', 'anonymous_apple', 'anonymous_email_no_password')
  );
  if p_kind in ('apple', 'anonymous_apple') then
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values ('apple.' || v_id::text, v_id, jsonb_build_object('sub', 'apple.' || v_id::text), 'apple', now(), now());
  end if;
  if p_kind like '%email%' then
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (v_id::text, v_id, jsonb_build_object('sub', v_id::text, 'email', v_id::text || '@qa.invalid'), 'email', now(), now());
  end if;
  return v_id;
end;
$$;

-- 用户通过 create_household 建家（成为协调人），返回 household_id。
create or replace function qa.household(p_coordinator uuid, p_name text default 'QA home')
returns uuid
language plpgsql
as $$
begin
  return qa.ok(
    qa.call(
      p_coordinator,
      format(
        'select public.create_household(%L, %L, %L, %L, %L, %L)::text',
        p_name, 'UTC', 'Dad', 'Coordinator ' || left(p_coordinator::text, 4), 'self', 'UTC'
      )
    ),
    'create_household'
  )::uuid;
end;
$$;

-- 直接写入一个成员（以 postgres 执行，绕过 RPC，用于搭测试场景），返回 members.id。
create or replace function qa.add_member(
  p_household_id uuid,
  p_uid uuid,
  p_role text default 'caregiver',
  p_name text default 'QA member',
  p_status text default 'active'
) returns uuid
language plpgsql
as $$
declare
  v_member_id uuid;
begin
  insert into public.members (household_id, user_id, name, relation, role, timezone, invite_status)
  values (p_household_id, p_uid, p_name, '', p_role, 'UTC', p_status)
  returning id into v_member_id;
  insert into public.notification_preferences (household_id, member_id) values (p_household_id, v_member_id);
  return v_member_id;
end;
$$;

create or replace function qa.member_id(p_household_id uuid, p_uid uuid)
returns uuid
language sql
as $$
  select id from public.members where household_id = p_household_id and user_id = p_uid and invite_status = 'active' limit 1;
$$;

-- 协调人生成一个加入码（直接以 postgres 写入 household_codes，不受 0060 的绑定要求影响）。
create or replace function qa.code_for(p_household_id uuid, p_expires_in interval default interval '15 minutes')
returns text
language plpgsql
as $$
declare
  v_code text;
  v_creator uuid;
begin
  select id into v_creator from public.members
    where household_id = p_household_id and role = 'coordinator' and invite_status = 'active'
    order by created_at limit 1;
  update public.household_codes set status = 'locked' where household_id = p_household_id and status = 'active';
  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when v_code <> '000000'
      and not exists (select 1 from public.household_codes where code = v_code and status = 'active');
  end loop;
  insert into public.household_codes (household_id, code, expires_at, created_by)
  values (p_household_id, v_code, now() + p_expires_in, v_creator);
  return v_code;
end;
$$;

-- 一个保证不存在的 6 位码（作废可能撞上的有效码）。
create or replace function qa.unused_code()
returns text
language plpgsql
as $$
begin
  update public.household_codes set status = 'locked' where code = '000000' and status = 'active';
  return '000000';
end;
$$;

-- 清空防猜码的全局状态（每个用到熔断的测试开头和结尾都调用）。
create or replace function qa.reset_join_guards()
returns void
language plpgsql
as $$
begin
  delete from public.join_failure_windows;
  update public.join_breaker set tripped_until = null, last_tripped_at = null, trips = 0 where id = 1;
  delete from public.join_attempts;
end;
$$;

-- 用于在多条语句（多个事务）之间传递 id。
create table if not exists qa.vars (k text primary key, v text not null);
create or replace function qa.set(p_k text, p_v text)
returns void
language sql
as $$
  insert into qa.vars (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create or replace function qa.get(p_k text)
returns text
language sql
as $$
  select v from qa.vars where k = p_k;
$$;

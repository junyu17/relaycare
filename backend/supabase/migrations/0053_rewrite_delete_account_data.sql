-- 0053: 重写 delete_account_data（Apple Review 5.1.1 应用内删除合规修复）
--
-- 问题（APPLE_REVIEW_RESPONSE_PACKAGE_2026-08-14 §1）：
--   0011 版本直接 `delete from members where user_id = p_user_id`，
--   而 tasks.requested_by_id / documents.uploaded_by_id / audit_events.actor_id
--   是 NOT NULL REFERENCES members(id) 且无 ON DELETE 动作（RESTRICT）。
--   Caregiver/Viewer 只要创建过任务/上传过文档/触发过审计，硬删成员行就会被
--   外键拒绝 -> delete-account Edge Function 报 500，auth 用户删除失败。
--
-- 选定语义（与 App/Privacy/Terms/删除页 对齐，2026-08-14）：
--   1. 协调的家庭（role='coordinator' 且 invite_status='active'）：整户级联删除，
--      连同该户全部数据与审计记录一并删除（delete from households 触发级联）。
--   2. 其他家庭中的成员记录：不删行，匿名化 + 软删除（沿用 0019 remove_member 模式），
--      user_id=NULL（解除对 auth.users 的引用，使用户删除成功）、
--      invite_status='removed'（从活跃成员列表消失）、name/relation/availability
--      置为占位符。保留成员行以维持 tasks/documents/audit 的外键引用完整性，
--      使共享协调/审计记录仍归属到"已删除成员"占位符。
--
-- Storage 清理采用可重试队列：数据库事务先记录待清理 household_id，再删除家庭；
-- Edge Function 只有在 Storage 与队列都清理成功后才删除 auth 用户。即使中途失败，
-- 下次调用仍能从队列恢复 household_id，避免产生永久孤立文件。
--
-- 不变：仅 service_role 可执行（delete-account Edge Function 调用）。

create table if not exists public.account_deletion_storage_cleanup (
  user_id uuid not null,
  household_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, household_id)
);

alter table public.account_deletion_storage_cleanup enable row level security;
revoke all on table public.account_deletion_storage_cleanup from anon, authenticated;

create or replace function public.delete_account_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.members%rowtype;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;

  -- 在家庭级联删除前持久化 Storage 清理目标。这里故意不加 auth.users/households FK：
  -- 两个父记录都会在流程中被删除，而队列必须在失败重试期间继续存在。
  insert into public.account_deletion_storage_cleanup (user_id, household_id)
  select distinct p_user_id, household_id
    from public.members
    where user_id = p_user_id
      and role = 'coordinator'
      and invite_status = 'active'
  on conflict (user_id, household_id) do nothing;

  -- 1) 删除该用户协调的家庭（级联删除该户全部数据，含审计）。
  delete from public.households
    where id in (
      select household_id from public.members
        where user_id = p_user_id
          and role = 'coordinator'
          and invite_status = 'active'
    );

  -- 2) 其余家庭中的成员：匿名化 + 软删除（保留行维持外键引用）。
  for v_member in
    select * from public.members
      where user_id = p_user_id
  loop
    -- 删除只属于该账号的通知偏好；共享业务记录仍保留。
    delete from public.notification_preferences
      where member_id = v_member.id;

    -- 清理系统生成历史中的资料姓名。用户自己输入的共享任务/文档正文属于该家庭，
    -- 不做不可预测的全文替换；这里只处理明确由 member_id 关联的系统字段。
    update public.audit_events
      set detail = replace(detail, v_member.name, 'Deleted member')
      where (actor_id = v_member.id
             or (entity_type = 'member' and entity_id = v_member.id::text))
        and v_member.name <> '';

    update public.role_notifications
      set values = jsonb_set(values, '{name}', to_jsonb('Deleted member'::text), true)
      where entity_type = 'member'
        and entity_id = v_member.id::text
        and values ? 'name';

    update public.members
      set user_id = null,
          invite_status = 'removed',
          name = 'Deleted member',
          relation = '',
          availability = '',
          timezone = 'UTC',
          invite_expires_at = null
      where id = v_member.id;

    -- 清除该家庭上下文（user_household_context 也会随 auth 用户级联删除，这里先清）。
    delete from public.user_household_context
      where user_id = p_user_id and household_id = v_member.household_id;
  end loop;
end;
$$;

revoke all on function public.delete_account_data(uuid) from public;
revoke all on function public.delete_account_data(uuid) from anon;
revoke all on function public.delete_account_data(uuid) from authenticated;
grant execute on function public.delete_account_data(uuid) to service_role;

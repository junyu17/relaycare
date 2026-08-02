# 上线前 QA：adversarial 测试与落地确认（B1/B2/B6/I4 + 支付面）

## 1. 前置条件（先于本 QA 完成）

1. 迁移按序应用到目标环境：**0024 → 0025 → 0026 → 0027 → 0028 → 0029 → 0030**
   （加入码维持 6 位数字，产品决策 2026-08-02，8 位加强方案已回退）
   （0024 与 0025 必须同批上线，中间态 `invite_member` 会挂起）。
2. 重编号后的迁移（0026/0027）与远端 `schema_migrations` 对齐：见下方 §3。
3. 三个 Edge Function 已重部署为最新版（verify-apple-receipt / apple-server-notifications / delete-account）。

## 2. 远端 schema 确认（SQL Editor 执行）

```sql
-- 0024/0025/0029 生效确认：RPC 存在
select proname from pg_proc where proname in
  ('invite_member','confirm_document_and_create_task','register_apple_subscription');
-- 应返回 3 行。

-- 0024 revoke 确认：客户端角色无 households/members 表级写权限
select grantee, privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name in ('households','members')
  and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE');
-- 应返回 0 行（仅 SELECT 存在）。

-- 0028 确认：register_apple_subscription 拒绝已撤销订阅
select prosrc from pg_proc where proname='register_apple_subscription';
-- 应包含 "Subscription is revoked or expired and cannot be reactivated"

-- 0030 确认：cleanup_old_audit 仅 service_role
select grantee from information_schema.role_routine_grants
where routine_name='cleanup_old_audit' and grantee in ('anon','authenticated');
-- 应返回 0 行；service_role 应有 execute
```

## 3. 迁移 history 对齐（B3 重编号后）

```bash
npx supabase link --project-ref <ref>
npx supabase migration list        # 确认 local 0026/0027 与 remote 一致
# 若远端 history 含有旧编号（0014_auth_email_autoconfirm / 0019_paywall_rpc_permissions）：
npx supabase migration repair --status reverted 0014_auth_email_autoconfirm 0019_paywall_rpc_permissions
# 0019b 若曾手工执行且未记录，按实际情况 repair；随后只推未应用部分
npx supabase db push
```

> 若远端之前是手工 `db query --file` 执行（非 CLI），`schema_migrations` 可能缺失部分记录：
> 对已执行但无记录的迁移用 `migration repair --status applied <version>` 补录，再核对 `migration list` 全绿。

## 4. 运行 adversarial 测试

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_ANON_KEY=<publishable key> \
SUPABASE_SERVICE_ROLE_KEY=<service_role（建议提供，启用角色/removed 用例与清理）> \
bash backend/qa/adversarial_tests.sh
```

覆盖（与整改报告 §4.3 对应）：

| 用例 | 断言 |
|---|---|
| B1 | coordinator 直 PATCH `households.plus_plan` 必须 4xx；直 INSERT households 必须 4xx |
| B2 | coordinator 直 PATCH/INSERT `members`（role/user_id/invite_status）必须 4xx |
| 合法路径 | caregiver 凭 6 位码 `join_by_code` 成功；入家后表级直写仍必须 4xx |
| viewer | 未入家 viewer 直 INSERT tasks/documents 必须 4xx |
| I4 | authenticated 调 `cleanup_old_audit` 必须 4xx（0030 落地后） |
| B6 | 8 位/7 位码必须被拒；6 位数字码格式通过（无效码 400） |
| 越权 | caregiver 调 `update_member_role`/`dissolve_household`/`invite_member` 必须 4xx（需 SERVICE_ROLE） |
| removed | 被移除成员读旧 household 必须失败（需 SERVICE_ROLE） |
| 支付 | （可选，需 `SANDBOX_JWS`）Sandbox JWS 走 Edge Function 在 production mode 必须被拒 |

全部 PASS 才视为上线门禁通过；`invite_member` 合法路径（coordinator 邀请 → 被邀请人 `accept_invite`）需在真机/手动脚本验证一次成功。

## 5. 支付面真机验收（人工，TestFlight）

- [ ] 购买（月/年）→ entitlement 生效 + `subscriptions` 登记（JWS 内含 `appAccountToken=auth.uid()`，用 `ALLOW_SANDBOX_PURCHASES=true` 环境）
- [ ] 恢复购买 → 成功且不误报 STALE（restore 模式按订阅周期放宽）
- [ ] 取消续订/退款 → Server Notification → entitlement 回退 free；随后重放旧 JWS 必须被拒（SUBSCRIPTION_NOT_RESTORABLE / RESTORE_NOT_ALLOWED）
- [ ] 生产环境确认 `APPLE_ACCEPTED_ENVIRONMENTS` 未设置或为 `Production`（严禁 `ALLOW_SANDBOX_PURCHASES=true` 遗留在生产）

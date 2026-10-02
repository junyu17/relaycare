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

| 用例     | 断言                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------- |
| B1       | coordinator 直 PATCH `households.plus_plan` 必须 4xx；直 INSERT households 必须 4xx                |
| B2       | coordinator 直 PATCH/INSERT `members`（role/user_id/invite_status）必须 4xx                        |
| 合法路径 | caregiver 凭 6 位码 `join_by_code` 成功；入家后表级直写仍必须 4xx                                  |
| viewer   | 未入家 viewer 直 INSERT tasks/documents 必须 4xx                                                   |
| I4       | authenticated 调 `cleanup_old_audit` 必须 4xx（0030 落地后）                                       |
| B6       | 8 位/7 位码必须被拒；6 位数字码格式通过（无效码 400）                                              |
| 越权     | caregiver 调 `update_member_role`/`dissolve_household`/`invite_member` 必须 4xx（需 SERVICE_ROLE） |
| removed  | 被移除成员读旧 household 必须失败（需 SERVICE_ROLE）                                               |
| 支付     | （可选，需 `SANDBOX_JWS`）Sandbox JWS 走 Edge Function 在 production mode 必须被拒                 |

全部 PASS 才视为上线门禁通过；`invite_member` 合法路径（coordinator 邀请 → 被邀请人 `accept_invite`）需在真机/手动脚本验证一次成功。

## 5. 支付面真机验收（人工，TestFlight）

- [ ] 购买（月/年）→ entitlement 生效 + `subscriptions` 登记（JWS 内含 `appAccountToken=auth.uid()`，用 `ALLOW_SANDBOX_PURCHASES=true` 环境）
- [ ] 恢复购买 → 成功且不误报 STALE（restore 模式按订阅周期放宽）
- [ ] 取消续订/退款 → Server Notification → entitlement 回退 free；随后重放旧 JWS 必须被拒（SUBSCRIPTION_NOT_RESTORABLE / RESTORE_NOT_ALLOWED）
- [ ] 生产环境确认 `APPLE_ACCEPTED_ENVIRONMENTS` 未设置或为 `Production`（严禁 `ALLOW_SANDBOX_PURCHASES=true` 遗留在生产）

## 6. 方案 B（匿名开始 + Apple 绑定）本地回归：一条命令，不需要 Docker

```bash
bash backend/qa/local_pg.sh             # SQL + Deno，全部通过退出码为 0
bash backend/qa/local_pg.sh --sql-only  # 只跑 SQL
bash backend/qa/local_pg.sh --keep      # 跑完不停库，便于手工查：psql -h backend/.localpg/sock -p 54399 -U postgres taskkin_all
```

不连任何 Supabase 项目。脚本在 `backend/.localpg/`（整个目录不进 git）用 Homebrew 的 Postgres 17 建私有实例（只开 unix socket），
加载 `local_pg_stubs.sql`（auth / storage / 角色 / realtime 的最小替身，**只存在于本地库，绝不放进迁移**），然后：

| 步骤             | 内容                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| shipped 库       | `supabase/migrations/` 0001–0059（TestFlight 之前 db push 的状态），跑 `sql/10_*`、`20_*`、`30_*` 和 `delete_account_regression.sql`      |
| schema dump 对照 | `all_in_one.sql`（0001–0003 的旧汇总）+ 0004 之后的迁移另建一库，`pg_dump --schema-only` 与 shipped 库的 public schema 必须完全一致       |
| all 库           | 再加 `supabase/pending_migrations/`（0060–0062），跑全部 `sql/*.sql`                                                                      |
| 并发             | 两个会话：`delete_auth_user_if_empty` 持锁时并发插入成员行要么外键失败、要么被复查看到；不会留下 user_id 被置空的成员行                   |
| deno check       | 用真实 supabase-js 类型检查 apple-identity-conflict / purge-abandoned-anonymous / delete-account                                          |
| deno test        | `supabase/functions/_tests/`：import map 把 supabase-js 和 StoreKit JWS 校验换成替身，Apple 的 HTTP 端点 stub 掉 fetch，不需要任何 secret |

SQL 测试用 `qa.call(uid, sql)` 模拟一次 PostgREST 请求（`request.jwt.claims` + `set local role authenticated`，出错只回滚这一次调用），
断言 1.9 能看到的英文 message 和 1.10 用的 hint。

上线顺序（方案 B）：0057 现在就上（含订阅伪造口子的修复：收回 API 角色对 upsert_subscription 的执行权；0058 开头重复一次作安全网）→ 0058、0059 和 apple-identity-conflict / delete-account / verify-apple-receipt 在 TestFlight 之前上
→ 0060 在 1.10 审核通过当天先上、再点发布 → 0061 + purge-abandoned-anonymous 在发布后一周内上 → 核对候选账号后再上 0062（定时任务）。
0060–0062 在那之前一直放在 `supabase/pending_migrations/`，避免更早的 `db push` 提前应用。

新函数都用 `--no-verify-jwt` 部署（apple-identity-conflict 在函数里校验会话；purge-abandoned-anonymous 只认 `x-cron-secret`）。
新增 secrets：`APPLE_TEAM_ID`、`APPLE_SIWA_KEY_ID`、`APPLE_SIWA_PRIVATE_KEY`（delete-account 撤销 Apple 授权，缺失时跳过撤销、删号照常）、
`CRON_SECRET`（purge 函数；同时存进 Vault，另存 `SUPABASE_URL` 供 0061 的 pg_net 调用）。私钥和 CRON_SECRET 只用 `--env-file` 读入，不写进仓库。

# 上线部署执行手册（B4：提交 → 迁移 → Edge → 验证）

> 生成日期：2026-08-02。所有修复在 `/tmp/taskkin-mvp`（验证副本）完成并通过 review；
> 以下命令按顺序在**原项目** `/Users/jun/Documents/Project/relaycare-mvp` 执行。
>
> ⚠️ **0024 / 0025 已于 2026-08-01 sudo 落地原项目**（内容与验证副本一致），
> 本手册**无需重复同步**；下方落地命令仅覆盖 0026-0031 与源码/QA 文件。

## 0. 变更清单（副本 → 原项目）

| 操作 | 文件 | 状态 |
|---|---|---|
| RENAME | `0014_auth_email_autoconfirm.sql` → `0026_auth_email_autoconfirm.sql` | ✅ 已执行 2026-08-02 |
| RENAME | `0019_paywall_rpc_permissions.sql` → `0027_paywall_rpc_permissions.sql` | ✅ 已执行 2026-08-02 |
| DELETE | `0019b_fix_update_my_name.sql`（从未被 CLI 应用，0022 已覆盖） | ✅ 已执行 2026-08-02 |
| COPY（新） | `0028_fix_register_revoked.sql`、`0029_confirm_document_atomic.sql`、`0030_revoke_audit_cleanup.sql`、`0031_harden_member_ops.sql` | ✅ 已执行 2026-08-02 |
| COPY（改） | `backend/README.md`、`src/lib/actions.ts`、`src/lib/db.ts`、`src/paywall/iap.ts`、`src/paywall/Paywall.tsx`、`src/auth/AuthScreen.tsx`、`src/auth/AuthContext.tsx`、`src/components/QRScanner.tsx`、`src/i18n.ts`、`src/App.tsx`、`backend/supabase/functions/verify-apple-receipt/index.ts`、`backend/supabase/functions/_shared/apple-jws.ts`、`app.json`、`plugins/with-dev-team.js`、`.github/workflows/ci.yml` | ✅ 已执行 2026-08-02 |
| COPY（新） | `backend/qa/adversarial_tests.sh`、`backend/qa/README.md`、`backend/qa/DEPLOY.md`、`docs/legal/COMPLIANCE_CHECKLIST.md`、`PROGRESS.md` | ✅ 已执行 2026-08-02 |
| 已落地 | `0024_harden_households_update.sql`、`0025_fix_invite_member_definer.sql` | 2026-08-01 完成 |

## 1. 落地同步（终端执行一次，sudo）

```bash
cd /Users/jun/Documents/Project/relaycare-mvp
# 1a. 迁移：重命名 + 删除 + 复制新迁移（0024/0025 已存在，跳过）
sudo mv backend/supabase/migrations/0014_auth_email_autoconfirm.sql backend/supabase/migrations/0026_auth_email_autoconfirm.sql
sudo mv backend/supabase/migrations/0019_paywall_rpc_permissions.sql  backend/supabase/migrations/0027_paywall_rpc_permissions.sql
sudo rm  backend/supabase/migrations/0019b_fix_update_my_name.sql
sudo cp /tmp/taskkin-mvp/backend/supabase/migrations/0028_fix_register_revoked.sql    backend/supabase/migrations/
sudo cp /tmp/taskkin-mvp/backend/supabase/migrations/0029_confirm_document_atomic.sql  backend/supabase/migrations/
sudo cp /tmp/taskkin-mvp/backend/supabase/migrations/0030_revoke_audit_cleanup.sql     backend/supabase/migrations/
sudo cp /tmp/taskkin-mvp/backend/supabase/migrations/0031_harden_member_ops.sql         backend/supabase/migrations/
# 1b. 其余修改/新增文件（覆盖原项目）
for f in backend/README.md src/lib/actions.ts src/lib/db.ts src/paywall/iap.ts src/paywall/Paywall.tsx \
         src/auth/AuthScreen.tsx src/auth/AuthContext.tsx src/components/QRScanner.tsx \
         src/i18n.ts src/App.tsx \
         backend/supabase/functions/verify-apple-receipt/index.ts \
         backend/supabase/functions/_shared/apple-jws.ts \
         backend/qa/adversarial_tests.sh backend/qa/README.md backend/qa/DEPLOY.md \
         docs/legal/COMPLIANCE_CHECKLIST.md PROGRESS.md \
         app.json plugins/with-dev-team.js .github/workflows/ci.yml; do
  sudo cp "/tmp/taskkin-mvp/$f" "$f"
done
```

## 1d. 原生配置变更（app.json 麦克风/allowBackup/版本号）需重新 prebuild（CNG 流程）

```bash
npx expo prebuild -p ios --clean   # 移除 NSMicrophoneUsageDescription、写入 buildNumber=1
cd ios && pod install
# 若用 TASK_KIN_TEAM_ID / TASK_KIN_NODE_PATH 环境变量覆盖本机签名/节点路径，prebuild 时导出即可
```

## 2. 本地门禁验证（push 前，无 sudo）

```bash
cd /Users/jun/Documents/Project/relaycare-mvp
npm run typecheck && npm run lint && npm run test
npx expo-doctor
npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org
```

## 3. git 提交（按主题分组）+ 推送

```bash
cd /Users/jun/Documents/Project/relaycare-mvp
# A. DB/RLS 安全修复 + 迁移重编号（B1/B2/B3/B6/I4）
git add backend/supabase/migrations/ backend/README.md backend/qa/
git commit -m "security(db): revoke client writes on households/members (0024/0025), fix migration numbering (0026/0027, drop 0019b), atomic document task (0029), 6-digit join codes (product decision), member ops hardening (0031), revoke audit cleanup (0030), adversarial QA"

# B. IAP 支付面（B5）
git add backend/supabase/functions/verify-apple-receipt/index.ts backend/supabase/functions/_shared/apple-jws.ts src/paywall/iap.ts
git commit -m "feat(iap): environment isolation, appAccountToken binding, signedDate freshness, error redaction (B5)"

# C. UI/UX（加入码 6 位全链路 + 原子确认客户端）
git add src/App.tsx src/auth/ src/components/QRScanner.tsx src/i18n.ts src/lib/actions.ts src/lib/db.ts
git commit -m "feat(ui): 6-digit join code input/scan/deeplink, atomic document confirm (B6/B7 client)"

# D. 之前的未提交工作（0018-0023 等既有改动）
git add -A
git commit -m "chore: pending work from previous sessions (0018-0023, IAP client, docs)"

git push origin main
```

## 4. 迁移 history 对齐 + db push（先于 Edge 部署）

```bash
cd /Users/jun/Documents/Project/relaycare-mvp/backend/supabase
npx supabase link --project-ref bwvtypmnhwzchrubziqy
npx supabase migration list
# 若远端 history 含旧编号记录（先 supabase migration list 按实际）：
npx supabase migration repair --status reverted 0014_auth_email_autoconfirm 0019_paywall_rpc_permissions
# 对"已手工执行但 schema_migrations 无记录"的版本（含 0019b 若曾执行）用 --status applied 补录（按实际）
npx supabase migration list   # 确认 local/remote 全绿
npx supabase db push          # 按序应用 0024-0031（0024 与 0025 同批，无中间态窗口）
```

## 5. Edge Function 部署（迁移之后，含环境变量）

```bash
cd /Users/jun/Documents/Project/relaycare-mvp/backend/supabase   # 已 link（步骤 4）
npx supabase functions deploy verify-apple-receipt --no-verify-jwt
npx supabase functions deploy apple-server-notifications --no-verify-jwt
npx supabase functions deploy delete-account --no-verify-jwt

npx supabase secrets set APPLE_BUNDLE_ID=cd.cc.relaycare
npx supabase secrets set APPLE_ACCEPTED_ENVIRONMENTS=Production
# 严禁在生产设置 ALLOW_SANDBOX_PURCHASES=true（TestFlight 验收后必须移除）
```

## 6. 上线门禁验证

```bash
# 6a. 远端 adversarial（迁移+Edge 部署完成后；与 0024-0030 实现一致）
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_ANON_KEY=<publishable key> \
SUPABASE_SERVICE_ROLE_KEY=<service_role> \
bash backend/qa/adversarial_tests.sh
# 全部 PASS 才算门禁通过

# 6b. 支付面真机验收（TestFlight，见 backend/qa/README.md §5）
```

## 7. 部署记录模板（提交到 docs/QA_Log.md 或 Release notes）

```markdown
## Release evidence 2026-08-02
- git commit SHA：<填入>
- Supabase migration 应用至：0031（`supabase migration list` 全绿）
- Edge Function 部署时间：<时间>（verify-apple-receipt / apple-server-notifications / delete-account）
- 环境变量：APPLE_ACCEPTED_ENVIRONMENTS=Production（无 ALLOW_SANDBOX_PURCHASES）
- adversarial 测试：PASS=<n> FAIL=0（backend/qa/adversarial_tests.sh）
- TestFlight 真机：购买/恢复/退款/删账号 验收 <结果>
```

# App Store 上架前修复（P0+P1，2026-07-26）

> 应对 Codex 评审的 3 个 P0 + 5 个 P1。验证：tsc 0 · eslint 0/0 · prettier 全过 · vitest 30/30 · iOS 模拟器构建成功。

## P0 修复

### P0-1 绕过购买 ✅

- `0011`：`revoke execute on function set_household_plus from authenticated`（仅 service_role 可调）。
- Paywall dev 切换改为**仅本地 demo 模式**（`!householdId`）；cloud 模式移除 dev 入口，走真实 IAP。
- `onDevSetPlus` 仅改本地 state；移除 `setHouseholdPlus` 客户端 RPC 封装。

### P0-2 订阅错误延长 ✅

- `0011`：`set_household_plus` 改收显式 `p_plus_until`（不再硬编码 365 天）；owner 为 null 时保留旧值。
- `verify-apple-receipt`：取 Apple 真实 `expiresDate` 写入；遇 `revocationDate`（退款/撤销）不授权；已过期不授权。
- 新 `subscriptions` 表 + `upsert_subscription`：按 `original_transaction_id` 登记映射，重复提交不会延长（同一交易同一到期时间）。

### P0-3 iOS 原生工程旧标识 ✅（已本地验证）

- `expo prebuild -p ios --clean` 重新生成 ios/：
  - `PRODUCT_BUNDLE_IDENTIFIER = cd.cc.relaycare`（原 care.relay.mvp）
  - `PRODUCT_NAME = TaskKinCare`、scheme `TaskKinCare`（原 RelayCareMVP）
  - ExpoIap(4.7.1) + openiap(2.4.4) 已装入 Podfile.lock
- `pod install` 经 gh-proxy.com 镜像装好 openiap（本网络 github 不通；已用临时 git insteadOf，跑完还原）。
- **iOS 模拟器 Debug 构建成功**（xcodebuild exit 0），ExpoIap 原生模块链接 OK。
- ios/ 与 Podfile.lock 为 CNG 产物（gitignored），未提交；你在自己机器再跑 `expo prebuild -p ios --clean && pod install` 即可复现。

## P1 修复

### P1 Server Notifications V2 ✅

- 新 Edge Function `apple-server-notifications`：验签通知 JWS -> 解码内嵌交易 -> 按通知类型（SUBSCRIBED/DID_RENEW/CANCEL/REFUND/REVOKE/EXPIRED...）映射状态 -> `sync_subscription_by_transaction` 更新家庭 entitlement。
- 配置：App Store Connect -> Server Notifications V2 -> 指向本函数 URL。
- `DID_CHANGE_RENEWAL_PREF`（关闭自动续订）不立即取消，到期前仍有效。

### P1 付费墙披露 ✅

- Paywall 加订阅披露文案（名称/时长/全额 $9.99·月·$99.99·年/自动续订/24h 取消规则/取消路径）。
- 加 "Manage subscription"（跳 `https://apps.apple.com/account/subscriptions`）。
- 生产无测试按钮（dev 切换仅本地）。

### P1 Terms 更新 ✅

- `site/terms{,-zh,-es}.html` + `docs/legal/TERMS_OF_SERVICE.md` §7/8：去掉"试点免费"，写明 Family Plus 定价/自动续订/Apple ID 取消。

### P1 应用内删除账号 ✅

- 新 Edge Function `delete-account`（service role）：用调用者 JWT 取 uid -> `delete_account_data`（删协调家庭级联 + 其余成员记录）-> `auth.admin.deleteUser`。
- `0011`：`delete_account_data` RPC。
- Settings 加"删除账号与家庭数据"入口（cloud 模式，二次确认）。

### P1 Sandbox 验收 ⏳（你来做）

- 购买/重复/恢复/到期/取消续订/退款/断网重试。

## Apple App 标识（已确认，已写入代码）

- Bundle ID：`cd.cc.relaycare`（app.json）
- App Apple ID：`6794837934`（已内置为 Edge Function 默认，可用 `APPLE_APP_APPLE_ID` 覆盖）
- App SKU：`relaycare-001`（ASC 应用标识，代码不用）
- 订阅产品：`TaskKin.care.pro.yearly`(6795121970) / `TaskKin.care.pro.mon`(6795120026)

## 需你部署/配置

1. **SQL**：按编号执行 `0011_paywall_security.sql`、`0012_subscription_binding.sql` 和 `0013_multi_households.sql`（0008-0010 已执行）。`0013` 是 Family Plus 最多三个家庭、订阅权益同步和家庭切换所必需的迁移。
2. **Edge Functions**：
   - `supabase functions deploy verify-apple-receipt`（已更新：按登录会话校验协调人、交易绑定和真实到期）
   - `supabase functions deploy apple-server-notifications`（新）
   - `supabase functions deploy delete-account`（新）
   - Secrets：补 `SUPABASE_ANON_KEY`（`delete-account` 与 `verify-apple-receipt` 使用，通常已自动注入）；设 `APPLE_BUNDLE_ID=cd.cc.relaycare`。`APPLE_APP_APPLE_ID` 已内置 6794837934，可不设。
   - 两个 Apple 函数同时验证 Sandbox 和 Production JWS；无需在发布时切换 `APPLE_ENVIRONMENT`。
3. **App Store Connect**：Server Notifications V2 -> URL 指 `apple-server-notifications`（生产 + Sandbox 各一）。
4. **iOS 构建**：本机 `expo prebuild -p ios --clean && cd ios && pod install`（github 不通时用 `git config --local url."https://gh-proxy.com/https://github.com/".insteadOf "https://github.com/"` 临时代理，跑完 unset）。然后 Xcode Archive 上传。
5. **上架前**：确认 `set_household_plus` 仅 service_role（已 revoke authenticated）。

## 上架检查清单

- [ ] 0011、0012、0013 SQL 已执行
- [ ] 3 个 Edge Function 已部署 + Secrets 配齐
- [ ] Server Notifications V2 URL 已配
- [ ] iOS prebuild + pod install + Archive 上传（cd.cc.relaycare）
- [ ] Sandbox：购买/恢复/到期/退款/取消 全通过

# iOS IAP 接入（付费墙第二步 iOS 部分，2026-07-26）

> 决策：IAP 分端做，iOS 用 StoreKit 2（expo-iap）；收据校验自建 Supabase Edge Function（验证 StoreKit 2 JWS 签名链）。
> 验证：`tsc` 0（排除 Edge Function）· `eslint` 0/0 · `prettier` 全过 · `vitest` 30/30。

## 一、App Store Connect 产品（已由你配置）

| 套餐 | Apple ID   | Product ID（SKU）         |
| ---- | ---------- | ------------------------- |
| 年   | 6795121970 | `TaskKin.care.pro.yearly` |
| 月   | 6795120026 | `TaskKin.care.pro.mon`    |

代码用 Product ID（SKU）；Apple ID 仅为 ASC 内部引用，不在代码里。

## 二、做了什么

### 1. 客户端 `src/paywall/iap.ts`（expo-iap 4.7.1）

- 产品 ID 常量 + `skuForPlan` / SKU->plan 映射。
- `initIap`：`initConnection` + 安装 `purchaseUpdatedListener`/`purchaseErrorListener`（作为 `requestPurchase` 返回值的兜底）。
- `fetchIosSubscriptions`：`fetchProducts({skus, type:"subs"})` 拿本地化价格。
- `purchaseIosSubscription(plan)`：`requestPurchase({request:{apple:{sku}}, type:"subs"})`，返回 `Purchase`（用返回值，回退 listener）。
- `verifyApplePurchase`：购买成功后把 `{productId, transactionId, purchaseToken(iOS JWS), householdId}` 发到 `verify-apple-receipt` Edge Function。成员身份由函数从登录 JWT 推导，客户端不再提交 owner ID。
- `finishIosPurchase`：`finishTransaction`。
- `restoreIos`：`getAvailablePurchases` -> 逐个校验 -> 命中即应用。
- `isIosIapAvailable`：仅 iOS 启用。

### 2. `src/paywall/Paywall.tsx` 接入真实购买

- cloud 模式（householdId 提供）+ iOS：仅协调人可发起真实 IAP（拉价格、购买、校验、finish、刷新、提示）；恢复走 `restoreIos`。
- local 模式 / 非 iOS：保留 dev 切换（测试用）。
- 购买中显示 spinner、禁用按钮。

### 3. App.tsx

- 给 Paywall 传 `householdId` / `onPurchased`（cloud 模式）。

### 4. 实时刷新套餐

- `db.ts` `subscribeHouseholdState` 加入 `households` 表订阅。
- `0009_realtime_households.sql`：`households` 加入 `supabase_realtime` publication。
- 效果：Edge Function 调 `set_household_plus` 更新 `plus_plan` 后，客户端自动 re-fetch，徽章/配额即时刷新。

### 5. 收据校验 Edge Function `backend/supabase/functions/verify-apple-receipt/index.ts`

- 用 `@apple/app-store-server-library` 的 `SignedDataVerifier`（拉取 Apple 根证书、校验 JWS 签名链 + bundleId）；兼容 Sandbox 与 Production。
- 用调用者 JWT 查验其为目标家庭的 active coordinator，再登记 Apple 原始交易。`0012_subscription_binding.sql` 确保一笔原始交易不能改绑到另一个家庭或账户；`0013_multi_households.sql` 将这笔订阅安全覆盖到该协调人新建的最多三个 Family Plus 家庭。
- `0011_paywall_security.sql`：`set_household_plus` 仅允许 service role 调用，且使用 Apple 的真实到期时间。

### 6. app.json

- `plugins` 加 `expo-iap`（prebuild 时加 iOS In-App Purchase capability）。
- `tsconfig.json` 排除 `backend/supabase/functions`（Deno 运行时，不参与 app tsc）。

## 三、购买流程

1. 用户开付费墙（cloud + iOS）-> 拉取月/年价格。
2. 点订阅 -> `requestPurchase` -> StoreKit sheet -> 完成 -> `Purchase`。
3. `verifyApplePurchase` -> Edge Function 校验 JWT、家庭协调人身份、JWS 和交易绑定 -> `register_apple_subscription`。
4. households 变更 -> realtime -> 客户端 re-fetch -> 徽章变 Plus。
5. `finishTransaction` + 提示"已激活"。

## 四、需你部署/配置（才能真机跑通）

1. **SQL**：按编号执行 `0009_realtime_households.sql`、`0010_paywall_service_role.sql`、`0011_paywall_security.sql`、`0012_subscription_binding.sql` 和 `0013_multi_households.sql`（0008 已执行）。
2. **Edge Function**：
   - `supabase functions deploy verify-apple-receipt`
   - Secrets：`APPLE_BUNDLE_ID=cd.cc.relaycare`、`SUPABASE_ANON_KEY`。`APPLE_APP_APPLE_ID` 已内置默认值；`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` 已有。
3. **原生构建**：`expo prebuild -p ios`（expo-iap 原生模块，Expo Go 不可用）+ Xcode build。
4. **沙盒测试**：App Store Connect 的沙盒账号；StoreKit Configuration（Xcode）可本地测。
5. **上架前**：确认 `set_household_plus` 仅留 service_role，并为 `apple-server-notifications` 配置 Sandbox 与 Production URL。

## 五、已知边界

- **Android 未做**（下一步）：同样的 iap.ts 结构，加 `request: {google: {skus}}` + `verify-google-receipt` Edge Function（Google Play Developer API 验 purchaseToken）。
- **JWS 字段**：expo-iap iOS `purchaseToken` 即 StoreKit 2 签名交易；若实际字段不同（如需 `getAllTransactionsIOS`），Edge Function 入参对应调整。
- **价格显示**：非 iOS / 未拉到价格时回退到 i18n 占位文案。
- **未提交**：等你说提交。

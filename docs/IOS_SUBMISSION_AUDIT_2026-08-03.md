# TaskKin Care — iOS 提审前完整审计

审计时间：2026-08-03（America/Los_Angeles）
审计基线：`main` / `d3fcb14`（工作树干净）
审计范围：iOS 版本提交 App Store Connect 审核的全链路——客户端代码、原生工程配置、IAP 与服务端校验、法务与隐私、上架素材
审计人：Claude（Opus 5）

## 结论

**结论：NO-GO —— 修复 P0-1 ~ P0-3 之前不要提交。**

Release 编译、类型检查、Lint、单测、依赖审计全部通过，服务端 IAP 校验逻辑（JWS 验签 + 账号绑定 + 撤销/过期判定）质量很高。
但存在 3 个会直接导致审核被拒的问题，其中 P0-1（沙盒交易被服务端拒绝）几乎必然导致 Apple 审核员无法完成订阅购买。

统计：P0 3 项 / P1 5 项 / P2 5 项 / 已验证通过 14 项。

---

## 一、P0 阻断项（不修复 = 大概率被拒）

### P0-1　服务端拒绝 Sandbox 交易，审核员无法完成购买

**证据**

- `backend/supabase/functions/_shared/apple-jws.ts:90` —— `acceptedEnvironmentsFromEnv()` 默认只返回 `{"Production"}`，仅当 `ALLOW_SANDBOX_PURCHASES=true` 或显式设置 `APPLE_ACCEPTED_ENVIRONMENTS` 时才加入 `Sandbox`。
- `backend/supabase/functions/verify-apple-receipt/index.ts:27` 使用该默认值，随后 `assertAppleBundleAndEnvironment(tx, BUNDLE_ID, ACCEPTED_ENVIRONMENTS)` 校验失败即抛错。
- 客户端拿到 `ok:false` → `Paywall.tsx` 弹出 `paywall.purchaseNotVerified`。

**影响**

App Review 审核员测试 App 内购买时**一律走 Sandbox 环境**（TestFlight 同理）。当前部署下，审核员点击订阅 → StoreKit 扣款成功 → 服务端验签环境不符 → 提示"购买无法验证"。
对应 Guideline **3.1.1 / 2.1**："In-app purchase does not work" 是最常见的拒审理由之一。

**修复**

在已部署的 Edge Function 上设置 secret（二选一）：

```bash
supabase secrets set APPLE_ACCEPTED_ENVIRONMENTS=Production,Sandbox
```

建议**长期同时接受两个环境**，而不是"审核期临时打开"——审核可能跨多天多轮，中途改配置容易漏。
安全性上可以接受：Sandbox JWS 需要沙盒 Apple ID 才能产生，普通用户拿不到；且 `register_apple_subscription` 已把 `p_environment` 落库，后续可按环境做统计与清理。

---

### P0-2　审计列表向用户直接显示未翻译的原始 i18n key

**证据**

- 提审截图 `t53.jpeg` 中，"Recent audit" 列表标题显示为字面量 `audit.timeline.event_deleted`、`audit.task.deleted`。
- `src/i18n.ts` 中不存在 `audit.task.deleted`、`audit.timeline.event_deleted`、`audit.member.name_updated` 三个 key（en/zh/es 均缺）。
- 这三个 action 由服务端写入：`backend/supabase/migrations/0017_delete_task_timeline.sql:25`（`task.deleted`）、`:51`（`timeline.event_deleted`），以及 `member.name_updated`（0018）。
- `src/i18n.ts:1527` 的兜底是 `?? key`，缺失时原样吐出 key。
- `src/types.ts:25-43` 的 `AuditAction` 联合类型同样漏了这三个值。

**影响**

Guideline **2.3.1 / 4.0**：可见的占位符/未完成 UI。更严重的是它**出现在提交给 Apple 的截图里**，审核员一眼可见。

**修复**

1. `src/i18n.ts` 三种语言各补 3 条 `audit.*` 标题 key，以及对应 `audit.detail.*` 明细 key（明细缺失时会回落到 SQL 里写死的英文 detail，zh/es 用户会看到英文）。
2. `src/types.ts` 的 `AuditAction` 补上 `"task.deleted" | "timeline.event_deleted" | "member.name_updated"`。
3. 修完重新截图（同时解决 P2-2）。

---

### P0-3　付费墙内没有"服务条款 / 隐私政策"链接

**证据**

- `src/paywall/Paywall.tsx` 只渲染了纯文本 `paywall.disclosure`（`s.disclosure`），全文无 `openLegal` / `Linking` 调用。
- 法务链接只存在于设置页：`src/App.tsx:2414`（Privacy）、`:2425`（Terms）。

**影响**

Guideline **3.1.2**（Subscriptions）明确要求：**在购买点**提供可点击的 EULA（服务条款）与隐私政策链接。这是订阅类 App 最高频的拒审点之一。

**修复**

在 `Paywall.tsx` 的 disclosure 下方加两个可点击链接，复用现成的 `openLegal(kind, language)`（`src/legal/consent.ts:35`）。需要把 `language` 传入 Paywall（目前只传了 `t`）。

---

## 二、P1 高风险项（强烈建议提审前修复）

### P1-1　付费墙宣传的 Plus 权益有一半没有实现，且未按套餐门禁

**证据**

| 付费墙宣称（`Paywall.tsx:30-40`）  | 实际情况                                                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Export (PDF/CSV) — Free 为 `—`     | 全仓库**没有任何 PDF/CSV 导出实现**；"导出"实为 `Share.share({ message: 纯文本 })`（`src/App.tsx:686`）                                                         |
| 且该功能未按套餐门禁               | 门禁是 `hasPermission(state, actor.role, "report:export")`（`src/App.tsx:2097`），只看**角色**不看套餐 → Free 用户同样能用                                      |
| Digest & quiet hours — Free 为 `—` | `PLAN_LIMITS.advancedNotifications` 在 `src/` 中**除测试外零引用**；digest 开关对 Free 用户同样可用（`src/App.tsx:1693`）                                       |
| Weekly report 自动 + 历史          | `weeklyReportAuto` 同样零引用，无自动生成任务                                                                                                                   |
| Audit 保留 30 天 → 3 年            | `auditRetentionDays` 零引用；清理仅有 SQL 函数（`0008_paywall.sql:261`、`0030_revoke_audit_cleanup.sql`），仓库内**没有任何 pg_cron / 定时 Edge Function 调度** |

真正被强制执行的只有：家庭数、成员数（服务端 RPC，`0014/0015/0020/0031`）、进行中任务数（`0008_paywall.sql:109` + 客户端）、OCR 月配额（仅客户端）、单文件 25MB（仅客户端）。

**影响**

Guideline **3.1.2 + 2.3.1**：订阅未提供所宣传的权益。审核员会实际点开付费墙对照功能。

**修复（二选一，建议 B）**

- A：把 4 项权益真正实现 + 加套餐门禁（工作量大，会拖慢上线）。
- B：**把对比表裁剪到当前真实交付的能力**（家庭数 1→3、成员 3→12、进行中任务 10→无限、OCR 1→50/月），删掉 Export / Digest / 自动周报 / 审计保留四行，等实现后再加回。

### P1-2　免责文案里的价格写死，非美区会与 StoreKit 价格不一致

**证据**：`src/i18n.ts:473 / 956 / 1458` 三种语言的 `paywall.disclosure` 都写死 `$9.99/month or $99.99/year`；而按钮价格来自 StoreKit 本地化价格（`findPrice()`）。日区/欧区用户会看到按钮 ¥1,500、说明文字 $9.99。

**影响**：Guideline **2.3.1 / 3.1.2**（价格信息不准确）。

**修复**：把 disclosure 改成带占位符的模板，注入 `findPrice(subs, "monthly"/"yearly")` 的实际值。

### P1-3　`aps-environment = development`，且本 App 根本不用远程推送

**证据**

- `ios/TaskKinCare/TaskKinCare.entitlements` → `aps-environment: development`。
- 全仓库无 `getExpoPushTokenAsync` / `getDevicePushTokenAsync` / `registerForPushNotifications`；通知全部是本地通知（`Notifications.scheduleNotificationAsync(..., trigger: null)`，`src/App.tsx:1433 / 1454`）。

**影响**：带了用不到的推送权限，上传后会收到 **ITMS-90078 "Missing Push Notification Entitlement"** 警告邮件；`development` 值本身也不适用于 App Store 分发。

**修复**：**直接移除推送 entitlement**（推荐，因为确实不用远程推送）。
⚠️ 注意 `.gitignore` 把 `ios/` 和 `android/` 都忽略了（CNG 模式，`expo prebuild` 会重新生成）。**改 `ios/` 目录会被下次 prebuild 冲掉**，必须改 `app.json` 的 `ios.entitlements` 或写一个 config plugin。

### P1-4　`ITSAppUsesNonExemptEncryption` 缺失

**证据**：`ios/TaskKinCare/Info.plist` 无该 key；`app.json` 无 `ios.infoPlist`。

**影响**：每次提交 App Store Connect 都会弹出口合规问询，答错会卡住审核。

**修复**：`app.json` 加

```json
"ios": { "infoPlist": { "ITSAppUsesNonExemptEncryption": false } }
```

（App 只用 HTTPS/系统标准加密，属于豁免。）

### P1-5　声明支持 iPad，但 UI 完全没有做平板适配

**证据**

- `app.json` → `ios.supportsTablet: true`。
- `ios/TaskKinCare/Info.plist` 的 `UISupportedInterfaceOrientations~ipad` 允许**横屏**。
- `src/App.tsx` 中无 `useWindowDimensions` / `Dimensions` / size class 分支，唯一的 `maxWidth` 是一处 12px 说明文字样式（`:1542`）。

**影响**

1. 声明 iPad 支持 → App Store Connect **强制要求 13 英寸 iPad 截图**（当前只准备了 iPhone 截图）。
2. 审核员会在 iPad 上测试；手机布局在 iPad 横屏下大概率拉伸/留白严重 → Guideline **2.4.1 / 4.0**。

**修复（二选一，v1 建议 A）**

- A：`app.json` 改 `supportsTablet: false`，本次只上 iPhone。最省事、零风险。
- B：保留 iPad，则需要：iPad 锁定竖屏 + 做布局适配 + 补 13" iPad 截图 + iPad 真机/模拟器 QA。

---

## 三、P2 建议修复项

### P2-1　"Enable Plus (testing)" 免费解锁按钮会打进 Release 包

`src/paywall/Paywall.tsx` 在 `!householdId && isCoordinator` 时渲染 `paywall.devEnablePlus`，`onDevSetPlus`（`src/App.tsx:766`）直接把套餐设为 Plus。全仓库 `src/` 内**没有任何 `__DEV__` 守卫**。

触发条件：App 落入本地 demo 模式，即 `EXPO_PUBLIC_SUPABASE_URL/ANON_KEY` 未注入。这两个变量在**构建时内联**，`.env` 已被 gitignore —— 一旦在 CI/新机器上没有 `.env` 就构建归档，发出去的包里会出现"免费开通 Plus"按钮 → Guideline **2.3.1 / 3.1.1**。

修复：`if (__DEV__)` 包住 dev 区块；并在 Release 构建里加一条断言，`isSupabaseConfigured === false` 时直接 fail build。

### P2-2　截图使用了真实名人姓名 "Bill Gates"

出现在 `T1.jpeg`（Care circle 卡片、My access）与 `t53.jpeg`（审计记录 4 条）。Guideline **5.2.1 / 5.2.5**：营销素材不应使用可识别的真实第三方姓名。
修复：改成虚构姓名后重新截图（与 P0-2 一并处理）。

### P2-3　注册需邮箱验证，审核员无法自助进入

`src/auth/AuthContext.tsx:116` 的 `signUp` 在未拿到 session 时提示 `auth.confirmEmailMsg`（"请查收确认邮件后再登录"）。
且购买路径是**协调人专属**（`verify-apple-receipt/index.ts:157` → `COORDINATOR_REQUIRED`）。

修复：在 App Review Notes 里提供

1. 一个已验证的 demo 账号（邮箱 + 密码）；
2. 明确路径："登录 → 创建家庭（自动成为 Coordinator）→ 设置页 → Upgrade to Family Plus → 选择年付"；
3. 说明"通过 6 位码加入的成员是普通成员，无法购买，属预期行为"。

### P2-4　`findPrice` 写死 iOS 产品 ID（Android 侧 bug）

`src/paywall/Paywall.tsx:54` 直接比对 `TaskKin.care.pro.yearly` / `.mon`，而 Android SKU 是小写独立 ID（`src/paywall/skus.ts:11-14`）。结果：Android 上 `findPrice` 永远返回 `null` → `onSubscribe` 一律走 `paywall.productUnavailable` 分支，**Android 完全无法订阅**。
iOS 不受影响，但同一文件，建议一起修：改用 `skuForPlan(plan)`。

### P2-5　订阅周期未在按钮上明示

`paywall.length.monthly` / `paywall.length.yearly` 两个 key 已定义但**全仓库无引用**。目前"1 个月/1 年"只藏在长段免责文字里。Guideline 3.1.2 希望标题、时长、价格三要素清晰可见。建议把时长上到按钮或按钮下方一行小字。

---

## 四、已验证通过项

| 项目                           | 结果   | 证据                                                                                                                                                                                                         |
| ------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| iOS Release 编译               | 通过   | `xcodebuild -configuration Release -sdk iphonesimulator` → `** BUILD SUCCEEDED **`                                                                                                                           |
| TypeScript                     | 通过   | `npm run typecheck` 无输出                                                                                                                                                                                   |
| ESLint                         | 通过   | `npm run lint` 无输出                                                                                                                                                                                        |
| 单元测试                       | 通过   | Vitest 4 文件 / 35 测试全绿                                                                                                                                                                                  |
| 生产依赖审计                   | 通过   | `npm audit --omit=dev --audit-level=high` → 0 high，10 moderate（均在 `@expo/*` 构建期依赖，不进包）                                                                                                         |
| 账号删除（5.1.1(v)）           | 通过   | 设置页"Delete account & household data" → `deleteAccount()`（`src/lib/db.ts:495`）→ `delete-account` Edge Function；二次确认弹窗                                                                             |
| 隐私政策 / 服务条款可达性      | 通过   | en/zh/es 六个页面 + delete-account 页均 HTTP 200（`junyu17.github.io/relaycare`）                                                                                                                            |
| 首启同意门                     | 通过   | `src/legal/ConsentGate.tsx`，未同意不放行，内含法务链接与语言切换                                                                                                                                            |
| 恢复购买                       | 通过   | `Paywall` 的 Restore 按钮 → `restoreIos()`；区分"服务端拒绝"与"基础设施错误"，后者透传不误报"无可恢复项"                                                                                                     |
| 管理订阅入口                   | 通过   | Plus 状态下跳 `apps.apple.com/account/subscriptions`                                                                                                                                                         |
| 权限用途说明                   | 通过   | 仅申请相机（`NSCameraUsageDescription`，用途描述准确：扫描家庭加入二维码）；未申请相册/麦克风/定位；文件选择走 `UIDocumentPickerViewController` 无需授权                                                     |
| Sign in with Apple（4.8）      | 不适用 | 仅邮箱密码 + 匿名登录，无第三方社交登录，故不触发 4.8 要求                                                                                                                                                   |
| 隐私清单 PrivacyInfo.xcprivacy | 通过   | 3 类 Required Reason API 已声明（FileTimestamp C617.1 / UserDefaults CA92.1 / SystemBootTime 35F9.1）；`NSPrivacyTracking=false`；无追踪 SDK                                                                 |
| OCR 数据流                     | 通过   | 默认 `device` provider（Apple Vision，数据不出设备）；`CloudOcrProvider` 显式抛错未启用                                                                                                                      |
| App 图标 / 启动屏              | 通过   | 1024×1024，prebuild 生成的 `App-Icon-1024x1024@1x.png` 已去 alpha；`SplashScreen.storyboard` 存在                                                                                                            |
| 医疗免责（1.4.1）              | 通过   | 首页常驻横幅："Coordination only. No diagnosis, prescription, billing, emergency triage, or deep EMR integration."；顶部"Non-PHI"标识                                                                        |
| 密钥安全                       | 通过   | 包内仅 publishable/anon key；`service_role` 只在 Edge Function 环境变量中                                                                                                                                    |
| 服务端 IAP 校验强度            | 通过   | JWS 验签 + bundleId + 环境 + productId 一致性 + `appAccountToken` 绑定 auth.uid() + `signedDate` 新鲜度（购买 24h / 恢复按周期放宽）+ 撤销/过期判定 + 家庭成员与协调人角色校验 + 已 revoked/expired 不可复活 |

---

## 五、提审前行动清单

**必须做（否则不要提交）**

1. `supabase secrets set APPLE_ACCEPTED_ENVIRONMENTS=Production,Sandbox`，并重新部署/确认 `verify-apple-receipt` 生效。
2. 补 3 个缺失的 `audit.*` i18n key（en/zh/es）+ `audit.detail.*` + `AuditAction` 类型。
3. 付费墙加"服务条款 / 隐私政策"可点击链接。

**强烈建议做**

4. 裁剪付费墙对比表到真实交付的 4 项能力（或补齐实现）。
5. disclosure 价格改为注入 StoreKit 本地化价格。
6. `app.json` 移除推送 entitlement、加 `ITSAppUsesNonExemptEncryption: false`、`supportsTablet: false`；改完跑 `expo prebuild --clean` 重新生成 `ios/`。
7. `__DEV__` 包住付费墙 dev 区块。

**提交材料**

8. 用修复后的构建重新截图（去掉 "Bill Gates"），导出 1242×2688（或 1320×2868）。
9. App Review Notes 写清 demo 账号 + 协调人购买路径（见 P2-3）。

**回归验证**

10. `npm run typecheck && npm run lint && npm run test`
11. `expo prebuild --clean` 后重新 `xcodebuild ... Release` 编译
12. 用**沙盒 Apple ID** 在真机/TestFlight 完整跑一遍：订阅年付 → 校验通过 → 权益生效 → 卸载重装 → 恢复购买成功

---

## 六、本次审计未覆盖

- 未执行真机 Archive + App Store Connect 上传验证（`xcodebuild archive` / `altool`）。
- 未用沙盒 Apple ID 实跑购买链路（需要真机与沙盒账号）。
- 未验证 Supabase 远端迁移版本与本地 `migrations/` 是否一致（需 `supabase migration list --linked`）。
- 未验证 `verify-apple-receipt` 等 Edge Function 的线上部署版本是否为当前代码。

# Google Play Console 配置引导（首次使用）

> 对应 Android 实现（2026-08-02 完成）：客户端 IAP 双平台（expo-iap Google Play Billing）、
> `verify-google-purchase` Edge Function（Play Developer API 验证）、`0034` register_google_subscription、
> Android 通知 channel、applicationId `cd.cc.taskkincare`、versionCode 1。
> 前置：一个 Google Play Console 开发者账号（一次性 $25 注册费）。

## 0. 本项目 Android 已就绪项

- `app.json` android.package=`cd.cc.taskkincare`、versionCode=1、allowBackup=false
- `expo prebuild -p android` 已生成工程（含 `com.android.vending.BILLING` 权限）
- 客户端 `src/paywall/iap.ts`：Android 购买（`google.skus` + `obfuscatedAccountId=uid`）、校验分发到 `verify-google-purchase`
- 后端 `verify-google-purchase` + `0034` 迁移（待部署）
- Android 通知 channel（`default`/`critical`）已创建

## 1. 创建应用

1. Play Console → **Create app** → 应用名 `TaskKin Care`、默认语言 English、应用类型 **App**、免费或付费（含订阅选 **Free** + 应用内购买）
2. 记录 **package name = `cd.cc.taskkincare`**（须与 app.json 一致）

## 2. 创建订阅产品（付费墙 SKU）

1. 左侧 **Monetize → Products → Subscriptions → Create subscription**
2. 创建两个订阅，**Product ID 必须与代码一致**：
   - **注意**：代码 SKU 是 `TaskKin.care.pro.mon`（月）与 `TaskKin.care.pro.yearly`（年），Play 的 Product ID 必须照抄这两串
   - 定价：月 $9.99、年 $99.99（与 iOS 一致）；订阅基期：月/年；自动续订开
3. 激活并提交（需完成商店信息）

## 3. 服务账号 + Play Developer API（verify-google-purchase 必需）

1. Google Cloud Console（同一账号）→ 创建**服务账号**（或直接用 Play Console → Setup → API access → 创建服务账号）
2. 在 Play Console → **Setup → API access** → 关联服务账号 → 授权 **Financial data / Subscriptions** 查看权限
3. 在 Google Cloud → IAM → 服务账号 → Keys → **Add key → JSON** → 下载
4. 该 JSON（含 `private_key`/`client_email`）即 `GOOGLE_SERVICE_ACCOUNT_JSON`
5. 确认 Play Console → API access 显示服务账号已链接

## 4. 部署后端（本仓库）

```bash
cd backend/supabase
HOME=/tmp/sbh supabase db push                      # 应用 0034
HOME=/tmp/sbh supabase functions deploy verify-google-purchase --no-verify-jwt
# secrets（value 从服务账号 JSON 全文粘贴，注意换行用 \n 转义或 base64）
HOME=/tmp/sbh supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
HOME=/tmp/sbh supabase secrets set GOOGLE_PLAY_PACKAGE=cd.cc.taskkincare
```

## 5. 测试轨道（首次上传前必须）

1. **App signing**：Play Console → Setup → App signing → 启用 **Google Play App Signing**（默认）。生成的**上传 key**（upload certificate）用于本地签名 AAB。
2. 生成本地上传 key：
   ```bash
   keytool -genkeypair -v -keystore upload-keystore.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
   ```
   配置 `android/app/build.gradle` signingConfig 指向它（或构建时用环境变量），生成 `.aab`。
3. **Internal testing** → 创建轨道 → 添加测试人员（邮箱列表）→ 上传 AAB → 发布
4. 测试人员安装 Play 版 app 后，用**真实测试卡**（Play Console → Payments → 测试卡）完成订阅购买，验证 `verify-google-purchase` 全链路

## 6. 上架信息（Go Live 前）

- **隐私政策 URL**：`https://junyu17.github.io/relaycare/privacy.html`（复用 iOS 三语页，需含订阅披露）
- **数据安全表单**：声明收集 邮箱/财务（购买）/照片文档（同 iOS App Privacy）
- 内容分级、目标受众、广告声明（无）
- 订阅披露：与 iOS 一致（自动续订、取消路径）

## 7. 本地构建（本仓库已支持）

```bash
cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew assembleRelease
# 产物：android/app/build/outputs/apk/release/app-release.apk（测试用）
# Play 上传需 .aab：./gradlew bundleRelease
```

## 8. 上线核对清单

- [ ] 订阅 SKU 与代码一致（`TaskKin.care.pro.mon` / `TaskKin.care.pro.yearly`）
- [ ] `GOOGLE_SERVICE_ACCOUNT_JSON` 已设 + Play API 授权
- [ ] 服务账号测试：`curl` Play API 返回 200（用服务账号拿 token 调 subscriptions 查询）
- [ ] Internal testing 真机：购买 → entitlement 生效（subscriptions 表 environment='Google'）→ 恢复购买
- [ ] 退款/取消：RTDN（Play 实时开发者通知）尚未接入（后续：webhook → revoke）；当前靠 expiry 自然过期
- [ ] 版本：versionCode 每次上传递增

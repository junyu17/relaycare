# TaskKin Care — Android 版开发结果评审

评审日期：2026-08-05
评审范围：`app.json` android 段、`android/` 原生工程、Play Billing 链路、`verify-google-purchase` / `play-rtdn`、Android 专属代码路径
评审人：Claude（Opus 5）
参照：iOS 已于 2026-08-04 提交 App Review

## 结论

**Android 侧 NO-GO，且差距比 iOS 当时大。** 3 项阻断、4 项高、3 项中。

JS 业务逻辑是双平台共用的，iOS 那 5 轮整改（同步、防连点、崩溃、乐观更新）Android 全都白拿。**问题全部集中在原生工程配置、后端凭证、和"从来没跑过"这三件事上。**

最要命的三条，每一条都会让 Android 版直接不可用：

1. Release 用 **debug 证书签名** → AAB 传不上 Play
2. `GOOGLE_SERVICE_ACCOUNT_JSON` **没配** → 所有 Android 购买验证必然 500
3. **`POST_NOTIFICATIONS` 权限缺失** → Android 13+ 一条通知都发不出来

而且 **Android 侧从未构建过 release AAB，也从未做过端到端测试**。iOS 那次「构建一直失败却被当成成功」（F1）的教训，在 Android 完全没有验证过。

---

## 一、阻断项

### A1　Release 用 debug 证书签名 —— AAB 传不上去

`android/app/build.gradle:111-114`：

```gradle
release {
    // Caution! In production, you need to generate your own keystore file.
    // see https://reactnative.dev/docs/signed-apk-android.
    signingConfig = signingConfigs.debug        // ← 用的是 debug 签名
}
```

`android/app/` 下只有 `debug.keystore`，没有任何 release/upload keystore。

这是 Expo prebuild 的默认模板，注释里自己就写了警告。**Play Console 拒收 debug 证书签名的包**（Android debug 证书的固定 CN=Android Debug，Play 明确不接受）。

**修复**：生成 upload keystore 并接进 gradle。详见 [PLAY_CONSOLE_RUNBOOK](./PLAY_CONSOLE_RUNBOOK_2026-08-05.md) 阶段 3。

⚠️ **keystore 一旦用于首次上传就不能换**（除非走 Play 的 key reset 流程）。生成后必须妥善备份，丢了等于这个 App 再也发不了更新。

### A2　`GOOGLE_SERVICE_ACCOUNT_JSON` 未配置 —— Android 购买 100% 验证失败

线上 Supabase secrets 实际只有：

```
GOOGLE_PLAY_PACKAGE            ← 只有这一个
```

而 `verify-google-purchase/index.ts:113` 是这么写的：

```ts
if (!SERVICE_ROLE || !SUPA_URL || !ANON_KEY || !GOOGLE_SA_JSON) {
  return fail("SERVER_MISCONFIGURED", "Server misconfigured", 500, { hasGoogleSa: Boolean(GOOGLE_SA_JSON) });
}
```

**函数会在第一行就 500**。用户在 Play 完成扣款 → 客户端拿 purchaseToken 去验证 → 500 → 权益不发放。钱扣了，Plus 没开。

这比 iOS 当时的 Sandbox 环境问题更严重——那个只影响审核，这个影响**所有真实付费用户**。

同一批缺失的还有 `play-rtdn` 需要的 `RTDN_EXPECTED_AUDIENCE` / `RTDN_EXPECTED_EMAIL`（见 A9）。

### A3　`POST_NOTIFICATIONS` 权限缺失 —— Android 13+ 通知全灭

`app.json` 的 plugins 数组：

```
['expo-font', 'expo-iap', 'expo-camera', './plugins/with-dev-team', './plugins/with-no-push-entitlement']
```

**`expo-notifications` 不在里面。** 它作为依赖会被 autolink（原生模块能用），但**config plugin 不会运行**——而正是这个 plugin 负责往 manifest 注入 `POST_NOTIFICATIONS`、通知图标和颜色。

实测确认 `android/app/src/main/AndroidManifest.xml` 里**没有** `POST_NOTIFICATIONS`：

```
grep -rn "POST_NOTIFICATIONS" android/   →  零命中
```

Android 13（API 33）起，没有这个权限声明，`Notifications.scheduleNotificationAsync` **不会显示任何东西**，且 `requestPermissionsAsync` 拿不到授权弹窗。而 targetSdk = 35，所有现代设备都在这个范围内。

连带影响：付费墙把「摘要与静默时段」列为 Plus 卖点（`paywall.row.notifications`），**在 Android 上这个卖点完全不工作**——和 iOS 那轮 R4 虚标是同一类问题。

**修复**：`app.json` plugins 加 `expo-notifications`（可带图标配置），然后 `expo prebuild -p android --clean` 重新生成。

---

## 二、高优先级

### A4　`SYSTEM_ALERT_WINDOW` 进了 release manifest

`android/app/src/main/AndroidManifest.xml:5`：

```xml
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>
```

注意它**同时**出现在 `src/debug/` 和 `src/main/` 两份 manifest 里。debug 那份无所谓，**main 这份会进 release 包**。

这个权限（"显示在其他应用上层"）来自 React Native 的开发者菜单浮层，业务上完全用不到。Play 对这类特殊权限敏感，会在政策审查里被问「你为什么需要这个」。一个照护协调 App 拿这个权限说不通。

**修复**：`app.json` 加

```json
"android": { "blockedPermissions": ["android.permission.SYSTEM_ALERT_WINDOW"] }
```

然后重新 prebuild，确认 main manifest 里消失。

### A5　targetSdk = 35，正好卡在 Play 的换代边界

没有 version catalog（`android/gradle/libs.versions.toml` 不存在），走 Expo 默认值（`ExpoRootProjectPlugin.kt:53-55`）：

```
minSdk 24  /  compileSdk 35  /  targetSdk 35
```

Google Play 每年把新应用的 target API 要求往上提一档，截止日在 8 月 31 日附近。**今天是 8 月 5 日**——35 现在应该还能过，但窗口只剩几周，之后任何更新都要重新提。

**建议现在就上 36**，省得刚上架就被卡更新：

```json
["expo-build-properties", { "android": { "compileSdkVersion": 36, "targetSdkVersion": 36 } }]
```

**以 Play Console 上传时的实际提示为准**——它会明确告诉你当前要求的最低 target API。

### A6　从未构建过 release AAB

```
android/app/build/outputs/bundle/release/   →  不存在
android/app/build/outputs/apk/release/      →  不存在
```

iOS 那边的根因（F1）就是**构建一直失败但被 `| tail` 吞掉了退出码**，导致连续几天在 JS 层修一个原生构建问题。Android 侧这条路**一次都没走过**。

在配任何 Play Console 之前，必须先确认能构建出 AAB，并且**显式判退出码**：

```bash
cd android && ./gradlew bundleRelease > /tmp/android-build.log 2>&1; echo "exit=$?"
grep -cE "^e: | error: |FAILURE:" /tmp/android-build.log
```

### A7　Android 侧零端到端验证

`docs/` 里 Android 相关证据只有 8 月 2 日的两张截图（`qa-android-auth.png`、`qa-android-home.png`）。8 月 4 日那次三设备实测**全是 iOS 模拟器**。

以下 Android 专属路径**全部零验证**：

| 路径                                    | 风险                                                             |
| --------------------------------------- | ---------------------------------------------------------------- |
| Play Billing 购买 / 确认（acknowledge） | expo-iap 的 Android 分支与 iOS 完全不同代码                      |
| 通知投递                                | A3 决定了它现在就是坏的                                          |
| 导出 PDF / CSV 分享                     | Android 的 `Sharing.shareAsync` 走 FileProvider，与 iOS 机制不同 |
| 边到边布局                              | 见 A8                                                            |
| 返回键 / 系统手势                       | iOS 没有对应概念，完全没测过                                     |

---

## 三、中优先级

### A8　`edgeToEdgeEnabled=true`，Android 15+ 强制边到边

`android/gradle.properties`：`edgeToEdgeEnabled=true`

Android 15（API 35）起强制边到边显示，系统栏变透明并覆盖在内容上。App 的顶部栏（TaskKin Care 标题行）和底部 Tab 栏如果没做 safe-area 处理，会被状态栏 / 手势条压住。

iOS 那边有 `SafeAreaView` 语义天然适配，Android 需要单独确认。**这是 Android 15/16 上最常见的视觉 bug**，也是 Play 审核截图里一眼能看出来的问题。

必须在真机 / 模拟器（Android 15 或 16）上逐屏确认。

### A9　RTDN 未配置，订阅状态不回流

`play-rtdn/index.ts:22-23` 需要：

```
RTDN_EXPECTED_AUDIENCE
RTDN_EXPECTED_EMAIL
```

两个都没设，Pub/Sub 主题也没建。

后果：用户在 Play 取消订阅、退款、或续订失败时，服务端**收不到通知**，`households.plus_plan` 不会及时降级——用户会一直保留 Plus 权益直到 `plus_until` 自然过期（最长一年）。

不阻断上架，但会造成真实的收入漏损。建议和 A2 一起配掉。

### A10　minSdk 24（Android 7.0）覆盖面 vs 实际可用性

Expo 默认 minSdk 24。覆盖面很好，但：

- Google Play Billing Library 的新版本对旧系统支持在收紧
- `expo-iap` 在 Android 7 上是否真能跑通，没验证过

要么实测一台 Android 7/8 设备，要么把 minSdk 提到 26（Android 8.0，通知 channel 的天然下限，与代码里 `ensureAndroidNotificationChannels` 的注释一致）。

---

## 四、验收通过的部分

| 项                            | 结论 | 依据                                                                                                              |
| ----------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------- |
| 双平台 SKU 分离               | ✅   | `skus.ts` 里 iOS 大写 / Android 小写独立定义，`skuForPlan(plan, platform)` 正确分发。这是 R12 那轮修好的          |
| `com.android.vending.BILLING` | ✅   | manifest 已声明                                                                                                   |
| `allowBackup=false`           | ✅   | 敏感数据不进 adb backup                                                                                           |
| 通知 channel                  | ✅   | `ensureAndroidNotificationChannels` 已实现 `default` / `critical` 两个 channel（但受 A3 影响发不出来）            |
| 订阅管理跳转                  | ✅   | `Paywall.tsx:307` Android 跳 `play.google.com/store/account/subscriptions`                                        |
| Android 幂等 / 待确认交易     | ✅   | `iap.ts` 持久化 pending purchase、verify 成功才 acknowledge，保留 Play 的 3 天未 ack 自动退款保护——这个设计是对的 |
| `obfuscatedAccountId` 绑定    | ✅   | 购买时绑当前用户，服务端可校验归属                                                                                |
| 迁移 0034 / 0035              | ✅   | `register_google_subscription`、`sync_subscription_state` 都在                                                    |
| JS 业务逻辑                   | ✅   | 与 iOS 共用，5 轮整改成果直接继承                                                                                 |

---

## 五、修复清单（按依赖顺序）

**第 1 批：代码 / 配置（必须先做，否则后面全部卡住）**

1. **A3** `app.json` plugins 加 `expo-notifications`
2. **A4** `app.json` 加 `android.blockedPermissions: ["android.permission.SYSTEM_ALERT_WINDOW"]`
3. **A5** 加 `expo-build-properties`，target/compile SDK → 36
4. `npx expo prebuild -p android --clean`
5. 核对生成结果：manifest 有 `POST_NOTIFICATIONS`、无 `SYSTEM_ALERT_WINDOW`

**第 2 批：签名与构建**

6. **A1** 生成 upload keystore + 接进 gradle（**立即异地备份**）
7. **A6** `./gradlew bundleRelease`，**显式判退出码**，确认产出 AAB

**第 3 批：后端凭证**

8. **A2** 建服务账号 → 下载 JSON → `supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON`
9. **A9** 配 RTDN（Pub/Sub 主题 + 两个 secret）

**第 4 批：验证**

10. **A7** Android 端到端走查（对照 iOS 的 SIM_E2E_TEST 那份清单）
11. **A8** Android 15/16 边到边逐屏确认
12. Play 内部测试轨道真实购买验证

具体操作步骤见 [PLAY_CONSOLE_RUNBOOK_2026-08-05.md](./PLAY_CONSOLE_RUNBOOK_2026-08-05.md)。

---

## 六、时间预期

⚠️ **Android 上架的关键路径不是代码，是 Google 的封闭测试要求。**

如果你的 Play 开发者账号是 **个人账号（Personal）**，2023 年 11 月之后注册的话，必须先完成**封闭测试：至少 12 名测试者、连续 14 天持续参与**，才能申请生产访问权限。

也就是说：**代码今天全修好，最快也要 14 天后才能提交生产。** 这条必须今天就启动。

组织账号（Organization）没有这个要求。你的账号类型在 Play Console → Setup → 开发者账号页面可以确认。

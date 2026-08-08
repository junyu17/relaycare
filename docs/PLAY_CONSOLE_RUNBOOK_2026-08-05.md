# TaskKin Care — Google Play Console 上架操作手册（新账号从零到提交）

制定日期：2026-08-05
前置：Play 开发者账号刚注册完成（$25 已付）
配套：[ANDROID_REVIEW_2026-08-05.md](./ANDROID_REVIEW_2026-08-05.md)（代码评审，含必修项 A1–A10）

> **和 iOS 最大的不同**：App Store 是「传上去 → 等 24-48 小时审核」。
> Play 对**新注册的个人账号**多了一道**封闭测试墙**——12 名测试者、连续 14 天，
> 之后才能申请生产访问权限。**这是 14 天的墙钟时间，必须今天就启动。**
>
> 下面的阶段 0 和阶段 1 请**并行推进**：阶段 0 在等人凑测试者，阶段 1 你在改代码。

---

## 阶段 0　先确认账号类型（今天必做，决定整体时间表）

Play Console → 左下角 **Setup（设置）→ 开发者账号 → 账号详情**，看账号类型：

| 类型                          | 封闭测试要求                          | 你的时间表                 |
| ----------------------------- | ------------------------------------- | -------------------------- |
| **Personal（个人）**          | ✅ 需要：**12 名测试者 × 连续 14 天** | 最快 14 天后才能提交生产   |
| **Organization（组织/企业）** | ❌ 不需要                             | 内部测试验证完即可提交生产 |

> 这条规则针对 2023 年 11 月之后注册的个人账号。Play Console 会在你尝试申请生产访问时明确提示当前要求——**以控制台实际提示为准**。

### 如果是个人账号，今天就开始凑 12 个测试者

- 12 个**不同的 Google 账号**（Gmail 即可），必须是**真人会去点开 App** 的
- 要求是"持续参与（opted-in）14 天"，中途退出会重新计时
- 亲友、同事都行，但他们得真的接受邀请并安装
- **建议凑 15 个**，留冗余

先把邮箱列表收集起来，等阶段 4 上传第一个包后立刻建轨道邀请。

---

## 阶段 1　代码侧必修（并行做，约 1–2 小时）

这几项不改，后面每一步都会卡住。详细分析见评审文档。

### 1.1　改 `app.json`

```json
{
  "expo": {
    "android": {
      "adaptiveIcon": { "foregroundImage": "./assets/icon.png", "backgroundColor": "#f7faf7" },
      "package": "cd.cc.taskkincare",
      "versionCode": 1,
      "allowBackup": false,
      "blockedPermissions": ["android.permission.SYSTEM_ALERT_WINDOW"]
    },
    "plugins": [
      "expo-font",
      "expo-iap",
      "expo-notifications",
      ["expo-build-properties", { "android": { "compileSdkVersion": 36, "targetSdkVersion": 36 } }]
    ]
  }
}
```

三处改动：

- **A3** 加 `expo-notifications` → 注入 `POST_NOTIFICATIONS`（不加的话 Android 13+ 一条通知都发不出来）
- **A4** `blockedPermissions` 剥掉 `SYSTEM_ALERT_WINDOW`
- **A5** `expo-build-properties` 把 target/compile SDK 提到 36

需要先装：`npx expo install expo-build-properties`

### 1.2　重新生成原生工程

```bash
npx expo prebuild -p android --clean
```

### 1.3　核对生成结果（三条都要对）

```bash
grep -c "POST_NOTIFICATIONS" android/app/src/main/AndroidManifest.xml     # 期望 1
grep -c "SYSTEM_ALERT_WINDOW" android/app/src/main/AndroidManifest.xml    # 期望 0
grep -n "targetSdk" android/app/build.gradle
```

---

## 阶段 2　生成上传密钥（A1）　🔴 生成后立刻备份

Play 拒收 debug 证书签名的包。当前 `android/app/build.gradle:114` 用的正是 debug 签名，必须换掉。

### 2.1　生成 keystore

```bash
keytool -genkeypair -v -keystore ~/taskkin-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

会问几个问题：密码（**记牢**）、姓名、组织、城市、国家代码（CN 或 US）。姓名那些随便填，不影响。

### 2.2　🔴 立刻备份

**这个文件丢了，这个 App 就再也发不了更新了**（只能走 Play 的 key reset 申诉流程，很麻烦）。

- 把 `~/taskkin-upload.jks` 存到密码管理器 / 加密云盘 / 移动硬盘，**至少两处**
- 密码单独存在密码管理器里
- **不要提交进 git**（`android/` 本来就在 `.gitignore` 里，但别放到仓库其他地方）

### 2.3　接进 gradle

在 `android/gradle.properties` 末尾加（这个文件也是 CNG 产物，prebuild 会重写，所以最好同时记在 `backend/qa/DEPLOY.md` 里）：

```properties
TASKKIN_UPLOAD_STORE_FILE=/Users/jun/taskkin-upload.jks
TASKKIN_UPLOAD_KEY_ALIAS=upload
TASKKIN_UPLOAD_STORE_PASSWORD=你的密码
TASKKIN_UPLOAD_KEY_PASSWORD=你的密码
```

改 `android/app/build.gradle` 的 `signingConfigs` 和 `release`：

```gradle
signingConfigs {
    debug { /* 保持原样 */ }
    release {
        storeFile file(TASKKIN_UPLOAD_STORE_FILE)
        storePassword TASKKIN_UPLOAD_STORE_PASSWORD
        keyAlias TASKKIN_UPLOAD_KEY_ALIAS
        keyPassword TASKKIN_UPLOAD_KEY_PASSWORD
    }
}
buildTypes {
    release {
        signingConfig = signingConfigs.release      // ← 从 signingConfigs.debug 改过来
        // 其余保持原样
    }
}
```

> **更稳的做法**：写一个 config plugin（`plugins/with-release-signing.js`）在 prebuild 时自动注入，这样 `expo prebuild --clean` 之后不用手改。iOS 那边的 `with-no-push-entitlement.js` 就是这个模式。**强烈建议这么做**——不然每次 prebuild 都会把签名配置冲掉，很容易出现"改了没生效"。

### 2.4　构建 AAB（显式判退出码）

```bash
cd android && ./gradlew bundleRelease > /tmp/android-build.log 2>&1; echo "exit=$?"
grep -cE "^e: | error: |FAILURE:" /tmp/android-build.log
ls -lh app/build/outputs/bundle/release/app-release.aab
```

**必须看 `exit=0` 且 error 数为 0**。iOS 那次连续几天白折腾，根因就是 `| tail` 把退出码吞了，构建一直是失败的却以为成功。

---

## 阶段 3　在 Play Console 创建应用

Play Console → **All apps → Create app**

| 字段             | 填什么                       |
| ---------------- | ---------------------------- |
| App name         | `TaskKin Care`               |
| Default language | English (United States)      |
| App or game      | **App**                      |
| Free or paid     | **Free**                     |
| 声明勾选         | 开发者计划政策、美国出口法规 |

创建后进入应用面板。**包名（`cd.cc.taskkincare`）不在这里填**——它在你第一次上传 AAB 时自动绑定，之后**永久不可改**。所以阶段 2 的 AAB 必须包名正确。

---

## 阶段 4　启用 Play App Signing 并上传第一个包

### 4.1　Play App Signing

Play Console → **Test and release → Setup → App signing**

新应用默认就启用 Play App Signing：你用**上传密钥**签名，Google 用它自己保管的**应用签名密钥**重新签名后分发。好处是上传密钥丢了还能补救。

**你不需要做任何操作**，上传第一个 AAB 时自动完成。

### 4.2　上传到内部测试轨道

Play Console → **Test and release → Testing → Internal testing → Create new release**

1. 上传 `app/build/outputs/bundle/release/app-release.aab`
2. **Release name**：`1.0.0 (1)`
3. **Release notes**：随便写，内部测试用
4. 保存 → Review release → **Start rollout to Internal testing**

> **内部测试轨道 ≠ 封闭测试轨道**。内部测试最多 100 人、立即生效、**不计入 12 人 14 天**。它的用途是你自己快速验证。封闭测试才是计时的那个（阶段 8）。

### 4.3　这一步会暴露的问题

上传时 Play 会立刻校验，常见报错：

| 报错                      | 原因                                      | 解法                               |
| ------------------------- | ----------------------------------------- | ---------------------------------- |
| 上传证书无效 / debug 证书 | A1 没修                                   | 回阶段 2                           |
| target API level 太低     | A5 没修                                   | 提到 36                            |
| 包名已被占用              | 不太可能                                  | 换包名（要同步改 app.json 和代码） |
| 缺少 64 位支持            | `reactNativeArchitectures` 已含 arm64-v8a | 应该不会遇到                       |

---

## 阶段 5　创建订阅产品

⚠️ **必须先完成阶段 4 的上传**，否则 Play 不让创建应用内商品。

Play Console → **Monetize → Products → Subscriptions → Create subscription**

### 5.1　两个订阅，Product ID 必须逐字匹配代码

| Product ID                 | 对应 | 代码位置                                         |
| -------------------------- | ---- | ------------------------------------------------ |
| `taskkin.care.pro.monthly` | 月付 | `src/paywall/skus.ts` `ANDROID_SUB_SKUS.monthly` |
| `taskkin.care.pro.yearly`  | 年付 | `src/paywall/skus.ts` `ANDROID_SUB_SKUS.yearly`  |

🔴 **Product ID 创建后永久不可改**，也不能删除重建同名的。**填之前对着 `skus.ts` 逐字核一遍。**

注意 Android 的 ID 是**全小写**，和 iOS 的 `TaskKin.care.pro.mon` / `TaskKin.care.pro.yearly` **不同**——这是故意的（Play 不允许大写）。别混用。

### 5.2　每个订阅要配的内容

- **Name**（用户可见）：`Family Plus (Monthly)` / `Family Plus (Yearly)`
- **Base plan**：
  - Monthly → 计费周期 **1 个月**，自动续订
  - Yearly → 计费周期 **1 年**，自动续订
- **价格**：月 $9.99 / 年 $99.99（与 iOS 一致），选好上架国家/地区
- **本地化**：en-US / zh-Hans / es 各一份名称 + 描述（App 支持三语）
- 状态设为 **Active**

### 5.3　订阅描述文案（可直接用）

```
Family Plus (Yearly)
Coordinate care across up to 3 households and 12 members. Unlimited in-progress
tasks, 50 document scans per month, PDF/CSV report export, notification digest
and quiet hours, automatic weekly reports with history, and 3-year audit history.
```

```
Family Plus (Monthly)
Same as yearly, billed monthly. Up to 3 households and 12 members, unlimited
in-progress tasks, 50 document scans per month, PDF/CSV export, digest and quiet
hours, automatic weekly reports, 3-year audit history.
```

---

## 阶段 6　服务账号 + Play Developer API（A2，购买验证必需）

**不做这一步，所有 Android 购买都会验证失败返回 500。**

### 6.1　在 Play Console 建服务账号

Play Console → **Setup → API access**

1. 如果提示要关联 Google Cloud 项目 → 点 **Create new project**（或选已有的）
2. 页面下方 **Service accounts** → **Create new service account** → 会跳转到 Google Cloud Console
3. 在 Cloud Console 里：**创建服务账号** → 名字填 `taskkin-play-verify` → 创建 → 不需要授予 Cloud 角色 → 完成
4. 点进这个服务账号 → **Keys** 标签 → **Add key → Create new key → JSON** → 下载
5. 回到 Play Console 的 API access 页 → 点 **Refresh service accounts** → 新账号出现 → **Grant access**

### 6.2　授权范围（给最小必要权限）

在 Grant access 的权限页勾选：

- **View financial data, orders, and cancellation survey responses**
- **Manage orders and subscriptions**

其余不给。保存。

> 权限生效可能要**几分钟到几小时**。如果验证接口报 401/403，先等一会儿再试。

### 6.3　把 JSON 配进 Supabase

下载的 JSON 长这样（含 `client_email` 和 `private_key`）：

```json
{"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...","client_email":"taskkin-play-verify@....iam.gserviceaccount.com",...}
```

```bash
cd /Users/jun/Documents/Project/relaycare-mvp/backend/supabase

# 整个 JSON 文件内容作为一个值传入（用文件读取避免换行/引号问题）
HOME=/tmp/sbh supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON="$(cat ~/Downloads/你下载的.json)"
HOME=/tmp/sbh supabase secrets set GOOGLE_PLAY_PACKAGE=cd.cc.taskkincare

HOME=/tmp/sbh supabase functions deploy verify-google-purchase
```

### 6.4　验证配好了

```bash
HOME=/tmp/sbh supabase secrets list | python3 -c "import json,sys; [print(s['name']) for s in json.load(sys.stdin)['secrets']]"
```

应该能看到 `GOOGLE_SERVICE_ACCOUNT_JSON` 和 `GOOGLE_PLAY_PACKAGE` 都在。

> 🔴 这个 JSON 是**服务账号私钥**，能操作你的 Play 订单数据。只放 Supabase secrets，**不要提交进 git、不要贴进聊天**。下载的那份用完从 `~/Downloads` 删掉。

---

## 阶段 7　内部测试轨道实测购买

### 7.1　加测试者

Play Console → **Internal testing → Testers** → 建一个邮箱列表，把你自己的 Google 账号加进去 → 保存 → 复制 **Join on the web** 链接。

### 7.2　加许可测试账号（这样购买不会真扣钱）

Play Console → **Setup → License testing** → 把同一批邮箱加进 **License testers**。

这些账号在测试轨道里购买订阅**不会真实扣款**，且续订周期会被大幅压缩（年付几分钟就"续订"一次），方便测状态流转。

### 7.3　安装并走一遍

1. 用测试账号的 Android 手机打开 Join 链接 → 接受 → 从 Play 安装
2. **必须从 Play 安装**，`adb install` 装的包拿不到 Play Billing 授权

### 7.4　必测清单（对照 iOS 那份）

| #   | 场景                                | 期望                                                   |
| --- | ----------------------------------- | ------------------------------------------------------ |
| 1   | 冷启动 → 同意页 → 注册 → 建家庭     | 无白屏、无崩溃                                         |
| 2   | **通知权限弹窗出现**（Android 13+） | 出现 → 说明 A3 修好了                                  |
| 3   | 触发一条角色通知                    | 通知栏能看到                                           |
| 4   | 打开付费墙                          | 价格来自 Play（本地货币），周期可见，条款/隐私链接可点 |
| 5   | **购买年付**                        | 完成 → **家庭升级为 Plus** ← 这条验证 A2               |
| 6   | 四项 Plus 权益                      | 导出 PDF/CSV、静默摘要、周报历史、审计保留 都可用      |
| 7   | 卸载重装 → 登录 → **恢复购买**      | Plus 恢复                                              |
| 8   | 导出 PDF / CSV                      | 分享面板弹出，文件能打开，中文不乱码                   |
| 9   | **边到边**（A8）：逐个 Tab 看       | 顶栏不被状态栏压住，底部 Tab 不被手势条盖住            |
| 10  | **返回键**在各页面                  | 行为合理，不直接退出 App                               |
| 11  | 连点两次创建任务                    | 只出 1 条                                              |
| 12  | 两台设备同步（删任务 / 移除成员）   | 秒级同步                                               |

第 5 条失败 = A2 没配好，去看 Supabase 函数日志。

---

## 阶段 8　封闭测试（个人账号必经，14 天）

Play Console → **Test and release → Testing → Closed testing → Create track**

1. 建轨道（名字随意，如 `closed-alpha`）
2. **Testers** → 建邮箱列表，把 **12+ 个测试者**加进去
3. 上传同一个 AAB（或新版本）→ 发布
4. 把 **Join on the web** 链接发给所有测试者，**确认每个人都点了接受并安装**

### 关键点

- 计时从**满足 12 人 opted-in** 那天开始，连续 **14 天**
- 中途有人退出，人数掉到 12 以下会**中断计时**
- Play Console 的封闭测试页会显示**当前进度**（多少人、还差几天），定期去看
- 这 14 天里你可以继续上传新版本修 bug，不影响计时

**这段时间正好用来做阶段 9 的商店信息和各种声明。**

---

## 阶段 9　商店信息与合规声明（14 天里完成）

Play Console 左侧 **Grow → Store presence → Main store listing**，以及 **Policy → App content**。

### 9.1　Main store listing

| 字段                          | 内容                                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| App name（30 字符）           | `TaskKin Care`                                                                                                                                        |
| Short description（80 字符）  | `Family caregiving, organized. One shared list with clear owners.`（64）                                                                              |
| Full description（4000 字符） | 用 [ASC_METADATA_EN](./ASC_METADATA_EN_2026-08-03.md) 第 4 节的描述，**删掉最后订阅条款那段的 "Apple Account" 措辞**，改成 "your Google Play account" |
| App icon                      | 512×512 PNG，32-bit，带 alpha                                                                                                                         |
| Feature graphic               | **1024×500 PNG/JPG，必填**（iOS 没这个，需要新做）                                                                                                    |
| Phone screenshots             | 至少 2 张，建议 4–8 张。16:9 或 9:16，最短边 ≥ 320px，最长边 ≤ 3840px                                                                                 |

> **Feature graphic 是 Play 独有的必填项**，iOS 那套素材里没有。1024×500，放 logo + 一句 slogan 即可。

截图可以直接用 Android 模拟器截（Pixel 8 Pro 分辨率合适），**演示数据里不要出现真人姓名**。

### 9.2　Store settings

- **App category**：`Productivity`（与 iOS 一致，不要选 Medical）
- **Tags**：选 3 个相关的
- **Contact details**：邮箱 `Billy.yu@me.com`、网站 `https://junyu17.github.io/relaycare/`

### 9.3　App content —— 一串必填声明，缺一项不能提交

Play Console → **Policy → App content**，逐项完成：

| 声明                            | 怎么填                                                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Privacy policy**              | `https://junyu17.github.io/relaycare/privacy.html`                                                                                                          |
| **Ads**                         | 选 **No, my app does not contain ads**                                                                                                                      |
| **App access**                  | 选 **All or some functionality is restricted** → 提供演示账号（邮箱 + 密码）+ 说明"购买订阅仅协调人可操作"。**和 iOS 审核备注同样重要，不写清楚会被当 bug** |
| **Content ratings**             | 填 IARC 问卷。全部选"否"（无暴力、无性内容、无赌博、无药物）→ 应得 Everyone / 3+                                                                            |
| **Target audience and content** | 目标年龄段选 **18 及以上**，不面向儿童                                                                                                                      |
| **News apps**                   | No                                                                                                                                                          |
| **COVID-19 contact tracing**    | No                                                                                                                                                          |
| **Data safety**                 | 见 9.4，**最花时间的一项**                                                                                                                                  |
| **Government apps**             | No                                                                                                                                                          |
| **Financial features**          | 选 **My app doesn't provide any financial features**（订阅走 Play Billing 不算）                                                                            |
| **Health apps**                 | 声明**不**处理健康数据。App 定位是非临床协调工具，Home 页有明确横幅。如果表单问到，如实说明"coordination only, non-clinical, does not store health records" |

### 9.4　Data safety（对应 iOS 的 App Privacy）

按实际情况填，**必须与代码行为一致**（Play 会抽查）：

| 数据类型                            | 收集 | 分享给第三方 | 用途               | 是否可选 |
| ----------------------------------- | ---- | ------------ | ------------------ | -------- |
| Email address                       | ✅   | ❌           | Account management | 必需     |
| Name（显示名）                      | ✅   | ❌           | App functionality  | 必需     |
| User IDs                            | ✅   | ❌           | App functionality  | 必需     |
| Photos / Files（上传的文档）        | ✅   | ❌           | App functionality  | 可选     |
| Purchase history（订阅状态）        | ✅   | ❌           | App functionality  | 必需     |
| App interactions（任务/时间线内容） | ✅   | ❌           | App functionality  | 必需     |

安全实践部分：

- **Data is encrypted in transit** → ✅（Supabase 全 HTTPS）
- **Users can request that data be deleted** → ✅
- **🔴 Data deletion URL**：`https://junyu17.github.io/relaycare/delete-account.html`

> 最后这条是 **Play 的硬性要求**：允许创建账号的 App 必须提供一个**App 外可访问的网页**让用户申请删除账号。仓库里 `site/delete-account.html` 已经有了，**提交前务必打开这个 URL 确认是活的**。

---

## 阶段 10　申请生产访问 + 提交

### 10.1　申请生产访问（个人账号）

14 天封闭测试达标后，Play Console 会解锁 **Apply for production access**。

需要填一份问卷，大致问：

- 你的测试怎么做的、收到了什么反馈
- 你为这个 App 做了哪些改进
- 目标用户是谁

**认真写**，这是人工审核。可以引用你的 QA 文档（三设备实测、5 轮整改）作为素材。

审核通常几天。

### 10.2　创建生产版本

Play Console → **Test and release → Production → Create new release**

1. 上传 AAB（可以直接从封闭测试轨道 **Promote release** 过来）
2. Release name / Release notes（三语）
3. **Rollout percentage**：首次上架建议 **20%** 灰度，观察崩溃率后再放到 100%
4. Review → **Start rollout to Production**

### 10.3　提交前最后核对

- [ ] 所有 App content 声明都是绿色 ✅
- [ ] Data safety 已填且含删除账号 URL
- [ ] Main store listing 完整（含 Feature graphic）
- [ ] 两个订阅产品状态 Active，Product ID 与 `skus.ts` 逐字一致
- [ ] `GOOGLE_SERVICE_ACCOUNT_JSON` 已配，内部测试实测购买通过
- [ ] 内容分级已生成
- [ ] 上传 keystore 已异地备份两份

---

## 附 A：整体时间表（个人账号）

```
今天    ├─ 阶段 0：确认账号类型 + 开始凑 12 个测试者   ← 最先做
        └─ 阶段 1–2：代码修复 + 生成 keystore + 构建 AAB（1–2 小时）
第 1 天  ├─ 阶段 3–4：创建应用 + 上传内部测试
        └─ 阶段 5–6：订阅产品 + 服务账号
第 2 天  └─ 阶段 7：内部测试实测购买（这里会暴露大部分问题）
第 3 天  └─ 阶段 8：封闭测试开跑 ← 14 天倒计时从这里开始
第 3–17 天 └─ 阶段 9：商店信息 + 全部声明（利用等待期）
第 17 天 └─ 阶段 10：申请生产访问
第 20 天左右 └─ 提交生产
```

**关键路径是那 14 天，不是代码。** 阶段 0 拖一天，整体就晚一天。

## 附 B：Play 与 App Store 的关键差异

| 维度         | App Store        | Google Play                      |
| ------------ | ---------------- | -------------------------------- |
| 新账号门槛   | 无               | 个人账号需 12 人 × 14 天封闭测试 |
| 产品 ID      | 可含大写         | **必须全小写**，且创建后不可改   |
| 包格式       | `.ipa`           | **`.aab`**（不接受 `.apk`）      |
| 签名         | Apple 托管       | 上传密钥 + Play App Signing 双层 |
| 独有必填素材 | 无               | **Feature graphic 1024×500**     |
| 删除账号     | App 内即可       | **必须额外提供网页 URL**         |
| 订阅测试     | Sandbox Apple ID | License testers + 测试轨道       |
| 审核时长     | 24–48 小时       | 首次可能数天到一周               |
| 灰度发布     | 分阶段（自动）   | 可自选百分比                     |

## 附 C：踩坑预警

1. **Product ID 打错了没法改** —— 填之前对着 `src/paywall/skus.ts` 逐字核。
2. **keystore 丢了发不了更新** —— 生成后立刻两处备份。
3. **prebuild 会冲掉签名配置** —— 强烈建议写成 config plugin（参考 `plugins/with-no-push-entitlement.js`）。
4. **服务账号权限要等生效** —— 配好后报 401/403 先等几分钟。
5. **必须从 Play 安装才能测购买** —— `adb install` 的包拿不到 Billing 授权。
6. **封闭测试人数掉下 12 会重新计时** —— 多邀几个留冗余。
7. **Data safety 填错会被下架** —— 必须和代码实际行为一致。

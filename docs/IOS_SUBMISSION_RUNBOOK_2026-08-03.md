# TaskKin Care — iOS 提审操作手册

制定日期：2026-08-03
前置状态：R4 复审已通过（0 阻断 / 0 高），代码可提审
配套文档：[ASC_METADATA_EN_2026-08-03.md](./ASC_METADATA_EN_2026-08-03.md)（文案）、[IOS_SUBMISSION_DEV_SPEC_2026-08-03.md](./IOS_SUBMISSION_DEV_SPEC_2026-08-03.md)（AC）

> 你问的"真机测试 → 截图 → Archive 到 ASC"方向是对的，但中间漏了两大块：
> **① 提交前的服务端 / 账户前置**（不做的话审核员买不了订阅，直接 3.1.2 被拒）
> **② ASC 后台的一堆问卷与关联**（首次提交订阅必须显式挂到版本上，这是最常见的漏项）
>
> 完整顺序是 **7 步**，下面按执行顺序排。

---

## 阶段 0　提交前置（必须最先做，且大多需要你本人操作）

### 0.1　确认 Paid Applications Agreement 已生效　🔴 最容易卡住

App Store Connect → **Business**（原 Agreements, Tax, and Banking）：

- [ ] **Paid Applications** 协议状态为 **Active**（不是 Pending / Expired）
- [ ] **Bank Account** 已填并通过验证
- [ ] **Tax Forms**（美国 W-8BEN / 各地区税表）已提交并 Active

**为什么最先做**：协议没生效时，App Store Connect 里的订阅产品会一直停在 "Missing Metadata"，**沙盒购买也无法完成**。这个流程涉及银行验证，可能要几天。所有其他步骤都可以并行，唯独这个必须提前启动。

### 0.2　Supabase 侧：确认审核员能完成沙盒购买

```bash
cd backend/supabase
HOME=/tmp/sbh supabase secrets list | grep APPLE_ACCEPTED_ENVIRONMENTS
```

- [ ] 值为 `Production,Sandbox`（不是只有 Production）
- [ ] 若不是，按 `backend/qa/DEPLOY.md` 第 2e 节设置并重新部署 `verify-apple-receipt`
- [ ] 线上函数日志首行可见 `acceptedEnvironments ["Production","Sandbox"]`

**为什么**：App Review 与 TestFlight **都走沙盒环境**。只接受 Production 的话，审核员点订阅会直接失败 → 100% 被拒。

### 0.3　生产 `.env` 就位

- [ ] 项目根目录 `.env` 存在，`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` 已填
- [ ] `EXPO_PUBLIC_OCR_MODE=device`（不是 mock）

**为什么**：R11 加了断言——生产构建缺配置会直接抛错。这是防止发出带免费解锁按钮的包，但也意味着 `.env` 缺失时 Release 包一启动就崩。

### 0.4　准备审核用演示账号

- [ ] 注册一个账号并**完成邮箱验证**（审核员不会去收验证邮件）
- [ ] 用它**创建一个家庭**（创建者自动成为 Coordinator——购买订阅必须是 Coordinator）
- [ ] 填充样例数据：几个任务（含 1 个 critical）、几条 timeline、1 份文档
- [ ] 演示数据里**不能出现真人姓名**（现在有 "Bill Gates"，Guideline 5.2.1）
- [ ] 记下邮箱 + 密码，填进 ASC 元数据文档的 `[DEMO EMAIL]` / `[DEMO PASSWORD]`

---

## 阶段 1　真机测试

### 1.1　装机

```bash
npx expo prebuild --clean      # 若 app.json 或原生依赖有变动
cd ios && pod install
```

Xcode 打开 `ios/TaskKinCare.xcworkspace`，选真机，Run。

### 1.2　功能走查（R4 遗留的三条路径必须实测）

| #   | 场景                                              | 期望                                                                      |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | 报表弹窗 → Export PDF                             | 生成 PDF、分享面板弹出、**中文不出方块**、内容与弹窗文本一致              |
| 2   | 报表弹窗 → Export CSV                             | 生成 `.csv` 文件、用 Numbers 打开列对齐、中文正常、9 列齐                 |
| 3   | Free 账号打开报表弹窗                             | 导出位置是**置灰锁图标**，点击弹出付费墙                                  |
| 4   | Plus 账号改静默时段为 `00:00–23:59`，触发普通通知 | **不弹**；触发 critical 通知 → **立即弹**                                 |
| 5   | digest 打开，连触 3 条普通通知                    | 不逐条弹；约 5 分钟后收到 1 条"3 条更新"汇总                              |
| 6   | 生成周报                                          | 历史列表出现该周记录；协调人收到"周报待检查"通知，**数字 = 未完成任务数** |
| 7   | 设置页 → 删除账号                                 | 二次确认后账号与家庭数据被删除，退回登录页                                |
| 8   | 付费墙                                            | 价格来自 StoreKit、周期可见、条款/隐私链接可点、恢复购买可见              |
| 9   | 语言切 zh / es                                    | 无 `audit.*` 之类的 key 字面量；PDF 标题也跟着切                          |

### 1.3　沙盒 IAP 端到端　🔴 必做

设置 → App Store → 沙盒账户，登录沙盒 Apple ID（**不要用真实 Apple ID**）。

- [ ] 购买年付 → 家庭升级为 Plus → 4 项权益（导出 / 静默摘要 / 周报历史 / 3 年审计）真实可用
- [ ] **删除 App 重装 → 登录 → 恢复购买 → Plus 恢复**（3.1.1 必查项）
- [ ] 沙盒里取消订阅 → 等过期 → 降级为 Free，4 项权益重新上锁
- [ ] 非 Coordinator 成员点订阅 → 显示"仅协调人可管理"提示，不报错

### 1.4　留证

把 1.2 / 1.3 的截图归档到 `docs/`，并在 `docs/QA_Log.md` 追加一节。这是我上一轮一直要的东西，也是万一被拒时的复盘依据。

---

## 阶段 2　截图

### 2.1　尺寸　⚠️ 之前转的 1242×2688 不够

| 尺寸                                          | 用途                   | 状态                                      |
| --------------------------------------------- | ---------------------- | ----------------------------------------- |
| **1320 × 2868**（6.9"，iPhone 16/17 Pro Max） | **必填组**             | ⬅ 需要重拍                                |
| 1242 × 2688（6.5"）                           | 可选，Apple 会自动缩放 | 已有（`~/Downloads/taskkin/1242x2688/`）  |
| iPad                                          | **不需要**             | `TARGETED_DEVICE_FAMILY = 1`，已关闭 iPad |

上传时以 ASC 界面标注 required 的那一组为准。只传 6.9" 一组即可，其余尺寸 Apple 自动生成。

### 2.2　内容

**必须在本轮修复合入后重拍**，因为旧截图里有已修复的问题（审计列表的 `audit.*` 字面量、付费墙没有法务链接）。

建议 6 张：Home / Tasks / Timeline / Docs(OCR) / Paywall / Settings

- [ ] 演示数据里**没有真人姓名**（"Bill Gates" 必须换掉）
- [ ] 付费墙那张能看到"名称 / 周期 / 价格"三要素 + 条款/隐私链接
- [ ] 审计列表那张没有 key 字面量

---

## 阶段 3　App Store Connect 后台准备（**最容易漏的一步**）

### 3.1　订阅产品　🔴 首次提交必须显式挂到版本上

App Store Connect → 你的 App → **Subscriptions**：

- [ ] **Subscription Group** 有本地化的**显示名称**（每种上架语言各一份）
- [ ] 两个订阅（`TaskKin.care.pro.yearly` / `TaskKin.care.pro.mon`）各自有：
  - [ ] 本地化的**显示名称 + 描述**（en / zh-Hans / es）
  - [ ] **定价**（所有上架区域）
  - [ ] **审核截图**（订阅产品自己也要一张付费墙截图）
  - [ ] 状态变为 **Ready to Submit**
- [ ] 🔴 回到**版本页面**，在 **In-App Purchases and Subscriptions** 区块**勾选这两个订阅**，让它们随本次版本一起提交

**最后这条是最常见的漏项**：订阅产品单独存在但没挂到版本上，审核员看不到它们，付费墙点下去什么都没有 → 以 Guideline 3.1.2 被拒。首次提交必须显式关联。

### 3.2　App Information

- [ ] 名称 `TaskKin Care`、副标题、分类（Primary: Productivity / Secondary: Lifestyle）
- [ ] **License Agreement**：用 Apple 标准 EULA，或填 `https://junyu17.github.io/relaycare/terms.html`
- [ ] **Content Rights**：声明不含第三方内容
- [ ] **Age Rating** 问卷 → 4+

### 3.3　Pricing and Availability

- [ ] App 本体 Free
- [ ] 上架区域

### 3.4　App Privacy　🔴 不填不能提交

按 [ASC_METADATA_EN_2026-08-03.md](./ASC_METADATA_EN_2026-08-03.md) 第 9 节的表填：

- [ ] Email / Name / User Content / Identifiers / Purchases —— 均 Collected + Linked，**均不用于 tracking**
- [ ] "Track across apps and websites" 答 **No**
- [ ] 第三方广告答 **No**
- [ ] Privacy Policy URL：`https://junyu17.github.io/relaycare/privacy.html`

### 3.5　版本元数据

从 ASC 元数据文档整段复制：

- [ ] Description / Promotional Text / Keywords / What's New
- [ ] Support URL + Marketing URL
- [ ] 截图（阶段 2）

### 3.6　App Review Information

- [ ] Demo 账号（阶段 0.4 的邮箱 + 密码）
- [ ] 联系人姓名 / 邮箱 / 电话
- [ ] **Notes**：整段复制 ASC 元数据文档第 10 节——里面写了"购买仅协调人可用"，不说清楚审核员很可能当 bug 报回来

---

## 阶段 4　Archive 与上传

### 4.1　构建前检查

- [ ] `app.json` 的 `version` = `1.0.0`、`buildNumber` = `"1"`
- [ ] `.env` 在位（阶段 0.3）
- [ ] Xcode → Signing：Team `255R6QQR97`，Automatically manage signing
- [ ] Scheme 的 Build Configuration 为 **Release**

### 4.2　Archive

Xcode 顶部设备选择器选 **Any iOS Device (arm64)** —— **不能是模拟器**，否则 Archive 菜单是灰的。

`Product → Archive` → Organizer 打开 → `Distribute App` → **App Store Connect** → **Upload**。

出口合规问题不会弹（`ITSAppUsesNonExemptEncryption = false` 已在 Info.plist 里自动应答）。

### 4.3　等待处理

上传后 ASC 需要几分钟到一小时处理构建。处理完成前，版本页面的 Build 选择器里看不到它。

如果收到 Apple 的警告邮件（如 ITMS-90xxx），先解决再继续。

---

## 阶段 5　TestFlight 内测（强烈建议，不要跳）

- [ ] 构建处理完成后，在 TestFlight 里加自己为内部测试员
- [ ] 装 TestFlight 版，**再跑一遍阶段 1.3 的沙盒 IAP**

**为什么不能跳**：TestFlight 走的是**沙盒环境**，和 App Review 一致。这是提交前最后一次、也是最接近审核员视角的验证——阶段 0.2 那个 secret 有没有生效，在这里会立刻暴露。真机 Debug 包跑通不等于 TestFlight 包跑通（签名、entitlements、Release 优化都不同）。

---

## 阶段 6　提交审核

- [ ] 版本页面选择处理好的 Build
- [ ] 再次确认订阅已勾选进本次版本（阶段 3.1 最后一条）
- [ ] **Version Release**：建议选 **Manually release this version**（审核通过后你自己决定何时上架，留出应急空间）
- [ ] `Add for Review` → `Submit to App Review`

审核通常 24–48 小时。被拒的话在 Resolution Center 回复，不需要重新上传构建（除非要改代码）。

---

## 附：本次最可能被拒的三个点

| 风险                   | 触发条件                           | 预防                    |
| ---------------------- | ---------------------------------- | ----------------------- |
| **3.1.2 订阅信息不全** | 订阅没挂到版本上 / 审核员买不了    | 阶段 0.2 + 3.1          |
| **5.2.1 使用真人姓名** | 截图或演示数据里的 "Bill Gates"    | 阶段 0.4 + 2.2          |
| **2.1 功能不完整**     | 审核员点导出没反应、付费权益不可用 | 阶段 1.2 + 1.3 全部实测 |

## 附：被拒后不需要重新 Archive 的情况

只改元数据（描述、关键词、截图、审核备注、演示账号）→ 在 ASC 改完直接重新提交，**不用重新上传构建**。
只有改代码才需要 bump `buildNumber` 重新 Archive。

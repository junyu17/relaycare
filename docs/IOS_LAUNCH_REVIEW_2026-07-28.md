# iOS 上线前完整评审（2026-07-28）

> 项目位置：`/Users/jun/Documents/project/relaycare-mvp`（已迁移）
> 评审范围：全量代码 + 后端迁移 0001-0013 + 3 个 Edge Function + 法律文档 + iOS 原生工程 + 配置
> 结论：**质量门全绿；安全已加固；有 3 项上线前必须处理项（已修 1 项，待你确认 2 项）**

## 一、验证结果（全绿）

| 检查                                      | 结果                                                                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit`                            | ✅ 0 错误                                                                                                                                                      |
| `eslint .`                                | ✅ 0/0                                                                                                                                                         |
| `prettier --check .`                      | ✅ 全过                                                                                                                                                        |
| `vitest run`                              | ✅ 30/30                                                                                                                                                       |
| `expo-doctor`                             | ✅ 20/20                                                                                                                                                       |
| `npm audit --omit=dev --audit-level=high` | ⚠️ 11 个（10 moderate + 1 high），均在 Expo SDK **构建期**传递依赖（brace-expansion via expo→@expo/fingerprint→minimatch），非运行时；移动端无可利用面，可接受 |

## 二、自上次评审以来的变化（未提交，由你/代理完成）

- **0012_subscription_binding**：Apple 订阅绑定到单一家庭+账号，防跨家庭/跨账号重放（`register_apple_subscription` RPC）。
- **0013_multi_households**：Plus 支持 up to 3 个家庭 + 切换（`user_household_context`、`subscription_households`、`list_my_households`、`set_active_household`；重写 `create_household`/`accept_invite`/`sync_subscription_by_transaction`）。
- **Edge Function 加固**：`verify-apple-receipt` / `apple-server-notifications` 双环境（Sandbox+Production）验签（TestFlight 安全）；`verify-apple-receipt` 校验调用者为该家庭协调人、owner 从鉴权推导（不再信任客户端传的 ownerId）。
- **客户端**：多家庭切换 UI（AuthContext `households`/`switchHousehold`、db `listMyHouseholds`/`setActiveHousehold`）；Paywall 限协调人购买。
- **隐私政策**：补应用内删账号说明 +（本次评审补）订阅/购买/设备端 OCR 披露。

## 三、安全评估（IAP / entitlement，现已扎实）

| 项            | 状态                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------ |
| P0-1 绕过购买 | ✅ `set_household_plus` 仅 service_role（0011）；客户端 dev 切换仅本地 demo                |
| P0-2 真实到期 | ✅ `register_apple_subscription` 用 Apple `expiresDate`；退款/过期不授权                   |
| 交易归属      | ✅ 0012 绑定 household+owner_user_id；Edge Function 验调用者为协调人；客户端不再传 ownerId |
| 退款/取消同步 | ✅ `sync_subscription_by_transaction` 更新所有关联家庭（多家庭），撤销/过期 -> free        |
| 多家庭        | ✅ 一订阅覆盖 up to 3 家庭；绑定不可迁移                                                   |
| 双环境        | ✅ Sandbox+Production 都验，TestFlight 不中断                                              |

## 四、上线前必须处理项

### 1. ✅ 已修：隐私政策订阅披露

Apple 要求披露购买/订阅数据处理。原隐私政策完全未提。本次已给 `docs/legal/PRIVACY_POLICY.md` + `site/privacy{,-zh,-es}.html` 补"购买与订阅"（Apple 处理支付、不存卡号、存交易标识/套餐/到期）+ "设备端 OCR（文件内容不外发）"披露。

### 2. ⚠️ 待你确认：0012 + 0013 已应用到 Supabase

这两个迁移是**新增且未提交**（git 未跟踪）。若未应用，`register_apple_subscription` / `list_my_households` / `set_active_household` 不存在 -> **购买与多家庭功能全挂**。

- 确认方式：Supabase Dashboard -> SQL Editor 跑 `select proname from pg_proc where proname in ('register_apple_subscription','list_my_households','set_active_household');` 应返回 3 行。
- 若没应用：依次执行 `0012_subscription_binding.sql`、`0013_multi_households.sql`。

### 3. ⚠️ 待你确认：部署的 Edge Function 与本地一致

本地 `verify-apple-receipt` / `apple-server-notifications` 有未提交改动（双环境 + 协调人校验）。你部署过--需确认**部署的是当前版本**（不是旧版）。若有疑问，重新 `supabase functions deploy verify-apple-receipt` 和 `apple-server-notifications --no-verify-jwt`。

### 4. 建议提交未提交工作

0012/0013 + IAP 加固 + 多家庭客户端 + 隐私政策更新均未提交。建议提交入库再上架（便于回溯）。

## 五、Apple 提交前清单

**App Store Connect 元数据**

- [ ] 隐私政策 URL：`https://junyu17.github.io/relaycare/privacy.html`（已含订阅披露）
- [ ] App Privacy 数据声明：声明收集 **联系信息-邮箱**、**财务信息-购买**（交易标识）、**照片或文档**（用户上传文件）；声明"未与第三方共享购买数据用于追踪"
- [ ] 服务条款 URL：`https://junyu17.github.io/relaycare/terms.html`（已含 IAP 定价）
- [ ] 支持 URL、年龄分级、截图
- [ ] Server Notifications V2 URL 已配（你说已完成）

**iOS 构建**

- [ ] `expo prebuild -p ios --clean && cd ios && pod install`（github 不通用临时 gh-proxy 镜像）
- [ ] Xcode Archive（bundle id `cd.cc.relaycare`，scheme `TaskKinCare`，含 In-App Purchase capability）
- [ ] 上传到 ASC

**Sandbox 真机验收**（你说部署已完成，建议正式提交前跑一遍）

- [ ] 购买（月/年）-> entitlement 生效 + `subscriptions` 表登记
- [ ] 恢复购买
- [ ] 多家庭：建第 2/3 个家庭自动带 Plus；切换家庭
- [ ] 取消续订 / 退款 -> Server Notification -> entitlement 回退 free
- [ ] 删账号 -> 账号+家庭数据清除

## 六、非阻断备注

- **测试覆盖**：30 项单测覆盖 domain/entitlement/ocr；多家庭客户端与 Edge Function 未单测，靠 Sandbox 验收。
- **依赖漏洞**：11 个均 Expo SDK 构建期传递依赖；上架可接受，后续升级 Expo SDK 清理。
- **OCR 模式**：`.env` `EXPO_PUBLIC_OCR_MODE=device`，上架包跑真实 on-device OCR（非演示）。
- **`APPLE_ENVIRONMENT`**：Edge Function 已双环境兼容，无需切换 secret。
- **iOS 用途描述**：expo-document-picker（系统选择器，无需 usage description）、expo-iap、on-device OCR（处理已选文件，不访问相机/相册）均无需额外 infoPlist；上架审核时若被问再补。

## 七、总体结论

代码与安全层面**已达上架标准**：质量门全绿、IAP/entitlement 三重防护（服务端配额 + 真实到期 + 交易绑定）、多家庭、退款同步、应用内删账号、隐私政策合规。**3 项上线前必须处理项**中我已修隐私政策披露；剩 2 项（确认 0012/0013 已应用、确认 Edge Function 部署为最新版）需你核实。确认后即可 Archive 上传 + Sandbox 验收 + 提交审核。

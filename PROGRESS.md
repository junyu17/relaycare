# TaskKin Care MVP 进度跟踪

> 项目总负责人视角的实时状态文件。
> 最后更新：2026-07-26（本轮：PM 审计、RBAC 加固、新 Supabase 项目迁移、原子任务 RPC 及 Release 重验）

## 当前阶段

方案 C（Supabase 后端 + 云同步 + 完整 UI）代码实现、iOS Release 构建、新 Supabase 项目迁移、三角色 RLS 会话验收和 P0 任务原子 RPC 已验证。web 能力已彻底移除，交付物为纯原生 RN app。

## 交付约束（已落实）

- **无网页端**：交付物为 RN app；web 能力已彻底移除（顶层依赖/app.json 配置/web 脚本/localStorage 持久化死代码全部删除）。
- **设置全在 app 内**：角色/邀请/通知/审计入口全在 Settings。
- **权限差异化**：`canAccessTab` 按 role 过滤；coordinator 见审计，caregiver 不见，viewer 仅 home/timeline/settings。
- **云同步**：Supabase Realtime 多设备实时同步；RLS 家庭隔离和三角色最小权限已在新项目部署。

## 已完成

### A2 + B3 + C1（本地 MVP 基线）✅

- A2 审计页 + 删死码；B3 工程化（git/vitest/eslint/prettier）；C1 小修（a11y/邀请过期/周报快照）。
- 验证：tsc/test(17)/lint/prettier/export 全绿。

### 方案 C：Supabase 云后端 + 同步

**后端**（`backend/supabase/migrations/`）：

- 9 表（households/members/role_definitions/notification_preferences/role_notifications/tasks/care_events/documents/audit_events）。
- RLS 按 `household_id` 隔离；`current_household_id()` 辅助函数。
- `0005_role_rbac.sql` 已部署：数据库与对象存储按 coordinator/caregiver/viewer 进一步限制读写。
- `0006_task_activity_rpc.sql` 已部署：P0 任务创建、认领、拒绝、交接、完成与其审计/角色通知以单一事务提交。
- RPC：`create_household`（建家庭+coordinator+审计）、`accept_invite`（接受邀请加入）、`create_task_with_activity`、`transition_task_with_activity`。
- Realtime：7 表发布订阅。新 Supabase 项目已按 `0001` 至 `0006` 完成建表、种子角色、私有 documents 存储桶、RBAC RLS 和原子任务流。

**app 数据层**（`src/lib/`）：

- `supabase.ts`（client，`EXPO_PUBLIC_` 环境变量）。
- `db.ts`（fetchHouseholdState/subscribeHouseholdState/createHousehold/acceptInvite）。
- `actions.ts`（11 个写操作走 Supabase + 审计 + 角色通知）。

**认证层**（`src/auth/`）：

- `AuthContext`（监听登录态，fetchHouseholdId）。
- `AuthScreen`（登录/注册）+ `OnboardingScreen`（创建/加入家庭）。

**App 集成**（`src/App.tsx`）：

- App gate：未配置 -> LocalApp（本地 demo）；配置 -> AuthProvider + CloudApp。
- LocalApp 改造支持 cloud props（state/actor/householdId/onSignOut）：13 个 handler 加 cloud 分支调 lib/actions，本地分支不变；复用全部 renderHome 等渲染。
- CloudApp：auth 闸门 + fetchHouseholdState + subscribeHouseholdState 实时订阅 + 渲染 LocalApp cloud。
- 顶栏 cloud 登出按钮；actor chips cloud 模式禁用切换；persist effect cloud 模式跳过。

## 验证

- `tsc --noEmit`：0 错误。
- `eslint .`：0 error 0 warning。
- `prettier --check`：全部通过。
- 2026-07-26 复验：`npm test` 17/17、`npx expo install --check` 通过；iPhone 17 模拟器 Release 构建、安装、冷启动通过，内嵌 JS bundle 已验证。
- **auth 全链路**（curl）：signup -> create_household RPC -> RLS 读 household/members/audit -> anon 隔离 ✅。
- **端到端多用户**（curl）：A 建家庭 -> A 邀请 caregiver -> B 注册 -> B accept_invite -> B 看到同家庭成员/household -> anon 看不到 ✅。
- **新 Supabase 项目迁移复核**（2026-07-26）：`0001` 至 `0005` 逐文件事务执行成功；9/9 业务表 RLS 已启用、22 条 public RLS 策略、3 条 storage.objects 策略、`documents` 私有桶和 3 个种子角色均存在；使用移动端 publishable key 的 REST smoke test 返回 HTTP 200。
- **三角色 RLS API 验收**（2026-07-26）：以临时 Coordinator / Caregiver / Viewer 的真实 JWT 会话验证：Coordinator 可建家庭、邀成员、建任务；Caregiver 可读取并认领任务；Viewer 可读成员和时间线，但不能读取或创建任务。测试家庭与临时账户已在验收后删除。
- **原子任务 RPC API 验收**（2026-07-26）：以临时真实 JWT 会话完成创建、认领、拒绝、再次认领、交接、接手和完成；最终任务状态、负责人及完成凭据正确，且同一任务对应 7 条审计记录与角色通知均已提交。测试数据已删除。

## 待办

- [ ] 运行时 UI 交互验证（iOS/Android 模拟器或真机：登录/建家庭/操作任务/多设备同步/推送）。
- [x] 以 Coordinator / Caregiver / Viewer 三个真实会话执行 API 级 RLS 验收。
- [x] 将 P0 任务创建、认领、拒绝、交接、完成及其通知/审计收敛为原子 RPC。
- [x] 将文档确认、任务创建和其通知/审计收敛为原子 RPC（2026-08-02：0029_confirm_document_atomic.sql + 客户端单 RPC 调用，B7）。
- [x] 试点前门禁决策：接受 autoconfirm + 6 位家庭码（产品决策 2026-08-02，B6/B6b；COMPLIANCE_CHECKLIST §9 同步）。

## 上线阻断整改（2026-08-02 第一批完成，见 backend/qa/ 与迁移 0024-0031）

- [x] B1/B2：0024 撤销客户端直写 households/members + guard triggers；0025 invite_member definer 化（须与 0024 同批上线）。
- [x] B3：迁移重编号 0014→0026、0019_paywall→0027、删除 0019b；0001-0031 连续。
- [x] B5：IAP 环境隔离（APPLE_ACCEPTED_ENVIRONMENTS 默认仅 Production）、appAccountToken 绑定、signedDate 新鲜度、统一撤销状态检查（0028 register 兜底）、错误脱敏。
- [x] B6：加入码维持 6 位数字（产品决策）+ 15 分钟过期 + 每用户限速（IP 级限速列为后续）。
- [x] B7：0029 文档确认→任务创建原子 RPC。
- [x] I4：0030 收回 cleanup_old_audit 的 authenticated 执行权（仅 service_role）。
- [x] 第二批重要级：I1（IAP finish 前置/restore 分类）、I2（update_my_name 显式 householdId，0031）、I5（actor 错误态）、I6（缓存剔除 rawText + 登出清理）、I7（realtime 非静默）、I8（invite 标注）、I14（allowBackup=false，待 prebuild 生效）、I15（join advisory lock）、发布配置（版本 1.0.0、麦克风权限移除、nodePath/teamId env 参数化、CI audit 阻塞门）。
- [x] I9：AuthScreen/OnboardingScreen 三语本地化（2026-08-02 完成，37 个 auth.* keys）。
- [x] 落地执行（2026-08-02）：全部变更已同步原项目并提交，commit SHA：634e932(security/db) / 9314c80(iap) / a68ec12(ui) / 86425b4(chore+release)。
- [ ] 上线部署剩余步骤：按 backend/qa/DEPLOY.md（migration repair/push → Edge deploy + env → adversarial 全 PASS → TestFlight 真机验收）。
- [x] OCR 真实接入：on-device 已实施 + 原生 build 验证通过（expo prebuild + pod install 92 pods + xcodebuild BUILD SUCCEEDED；dariyd 编译链接 OK；node_modules .sh 执行位已 chmod 修复）。真机 OCR 端到端（上传文档→识别）待 cloud 登录交互测试。

## 待用户决策

- 汇报机制：方案 A（会话内按里程碑）。
- web 能力：已决策彻底移除（2026-07-24）。
- OCR 时机：原决策 1B（试点后），2026-07-24 更新为现在实施（on-device 已上线）。
- OCR 技术路线：方案 A 已实施（on-device，@dariyd/react-native-text-recognition，image+PDF+中文，无 PHI 风险）；云端兜底（Textract/Document AI，需 BAA）已预留 stub，切换 `EXPO_PUBLIC_OCR_MODE=cloud`。

## 本轮修复（2026-07-24）

- **修复 cloud 通知 titleKey bug**：`actions.ts` 的 createTask/confirmDocumentAndCreateTask 用了 i18n 不存在的 `notification.title.taskCreated`，导致 cloud 模式推送与通知列表显示原始 key；已对齐 domain.ts（criticalTask/newTask）。
- **统一 uniqueId**：domain.ts 复用 `lib/id.ts`，消除重复实现。
- **推送语言持久化**：新增 `lib/language.ts`，CloudApp 推送按用户选择语言渲染（原硬编码 en）。
- **彻底移除 web**：删除 react-dom/react-native-web 顶层依赖、app.json web 配置、web 脚本、localStorage 持久化死代码、showMessage web 分支、README web 运行说明。
- 全绿：tsc 0 错误 · vitest 17/17 · eslint 0/0 · prettier 全过。

## 风险与备注

- Supabase 项目 email confirmation 已关闭；**产品决策（2026-08-02）：接受 autoconfirm + 6 位家庭码加入（非强身份认证模型）**，文档已同步（docs/legal/COMPLIANCE_CHECKLIST.md §9）；真实邮箱注册/投递验收不再作为上线前置，列为后续增强。
- 新项目的普通注册端点对合成测试地址受邮箱校验与发送频率限制；真实邮箱注册及邮件投递仍需在上线前真机验收。
- 邀请流程：当前 invite 生成 pending member（member_id 作为邀请码）；生产可加邀请链接/deep link。
- 原生 app 持久化：cloud 模式数据在 Supabase（不丢）；本地 demo 模式不持久化（纯内存，web localStorage 已随 web 能力移除）。
- `node_modules/.bin` 执行位曾丢失（已修复 target +x）；如再现 `npm rebuild` 或重装。

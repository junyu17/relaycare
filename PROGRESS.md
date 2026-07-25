# RelayCare MVP 进度跟踪

> 项目总负责人视角的实时状态文件。
> 最后更新：2026-07-24（本轮：web 移除 + bug 修复）

## 当前阶段

方案 C（Supabase 后端 + 云同步 + 完整 UI）**已完成并验证**。app 现支持：注册/登录 -> 创建/加入家庭 -> 完整照护协同 UI -> 多设备实时同步 -> 数据云端持久化（换手机/删 app 不丢）。web 能力已彻底移除，交付物为纯原生 RN app。

## 交付约束（已落实）

- **无网页端**：交付物为 RN app；web 能力已彻底移除（顶层依赖/app.json 配置/web 脚本/localStorage 持久化死代码全部删除）。
- **设置全在 app 内**：角色/邀请/通知/审计入口全在 Settings。
- **权限差异化**：`canAccessTab` 按 role 过滤；coordinator 见审计，caregiver 不见，viewer 仅 home/timeline/settings。
- **云同步**：Supabase Realtime 多设备实时同步；RLS 家庭隔离。

## 已完成

### A2 + B3 + C1（本地 MVP 基线）✅

- A2 审计页 + 删死码；B3 工程化（git/vitest/eslint/prettier）；C1 小修（a11y/邀请过期/周报快照）。
- 验证：tsc/test(17)/lint/prettier/export 全绿。

### 方案 C：Supabase 云后端 + 同步 ✅

**后端**（`backend/supabase/migrations/`）：

- 9 表（households/members/role_definitions/notification_preferences/role_notifications/tasks/care_events/documents/audit_events）。
- RLS 按 `household_id` 隔离；`current_household_id()` 辅助函数。
- RPC：`create_household`（建家庭+coordinator+审计）、`accept_invite`（接受邀请加入）。
- Realtime：7 表发布订阅。已在用户 Supabase 实例建表 + 种子角色。

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
- **auth 全链路**（curl）：signup -> create_household RPC -> RLS 读 household/members/audit -> anon 隔离 ✅。
- **端到端多用户**（curl）：A 建家庭 -> A 邀请 caregiver -> B 注册 -> B accept_invite -> B 看到同家庭成员/household -> anon 看不到 ✅。

## 待办

- [ ] 运行时 UI 交互验证（iOS/Android 模拟器或真机：登录/建家庭/操作任务/多设备同步/推送）。
- [ ] 试点前门禁：开启 email confirmation + 隐私政策/ToS + 真机设备矩阵 QA。
- [ ] OCR/AI 真实接入：已决策推迟到试点后（决策 1B），试点前在 UI 标注“OCR 为演示数据”。

## 待用户决策

- 汇报机制：方案 A（会话内按里程碑）。
- web 能力：已决策彻底移除（2026-07-24）。
- OCR/AI 时机：已决策试点后再投入（决策 1B，2026-07-24）。
- OCR 技术路线：已决策方案 A（on-device 优先，Apple Vision + Google ML Kit）+ 预留云端兜底（Textract/Document AI，需 BAA）；`src/lib/ocr/` provider 抽象已就位，切换只需 `EXPO_PUBLIC_OCR_MODE`（2026-07-24）。

## 本轮修复（2026-07-24）

- **修复 cloud 通知 titleKey bug**：`actions.ts` 的 createTask/confirmDocumentAndCreateTask 用了 i18n 不存在的 `notification.title.taskCreated`，导致 cloud 模式推送与通知列表显示原始 key；已对齐 domain.ts（criticalTask/newTask）。
- **统一 uniqueId**：domain.ts 复用 `lib/id.ts`，消除重复实现。
- **推送语言持久化**：新增 `lib/language.ts`，CloudApp 推送按用户选择语言渲染（原硬编码 en）。
- **彻底移除 web**：删除 react-dom/react-native-web 顶层依赖、app.json web 配置、web 脚本、localStorage 持久化死代码、showMessage web 分支、README web 运行说明。
- 全绿：tsc 0 错误 · vitest 17/17 · eslint 0/0 · prettier 全过。

## 风险与备注

- Supabase 项目 email confirmation 已关闭（开发测试）；上线前需开启 + 配邮件。
- 邀请流程：当前 invite 生成 pending member（member_id 作为邀请码）；生产可加邀请链接/deep link。
- 原生 app 持久化：cloud 模式数据在 Supabase（不丢）；本地 demo 模式不持久化（纯内存，web localStorage 已随 web 能力移除）。
- `node_modules/.bin` 执行位曾丢失（已修复 target +x）；如再现 `npm rebuild` 或重装。

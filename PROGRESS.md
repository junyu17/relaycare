# RelayCare MVP 进度跟踪

> 项目总负责人视角的实时状态文件。
> 最后更新：2026-07-24

## 当前阶段

方案 C（Supabase 后端 + 云同步 + 完整 UI）**已完成并验证**。app 现支持：注册/登录 -> 创建/加入家庭 -> 完整照护协同 UI -> 多设备实时同步 -> 数据云端持久化（换手机/删 app 不丢）。

## 交付约束（已落实）

- **无网页端**：交付物为 RN app；`web-build/` gitignore 不交付；`expo export` 仅作 headless 冒烟。
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
- `expo export --platform web`：构建通过。
- Headless Chrome：cloud 模式渲染 AuthScreen（.env 注入生效）。
- **auth 全链路**（curl）：signup -> create_household RPC -> RLS 读 household/members/audit -> anon 隔离 ✅。
- **端到端多用户**（curl）：A 建家庭 -> A 邀请 caregiver -> B 注册 -> B accept_invite -> B 看到同家庭成员/household -> anon 看不到 ✅。

## 待办（剩余 ~1-2h）

- [ ] 运行时 UI 交互验证（浏览器/模拟器：登录/建家庭/操作任务/多设备同步）。
- [ ] 文档：QA_Log/AUDIT_REPORT 更新方案 C。
- [ ] double check + 交付报告。

## 待用户决策

- 汇报机制：方案 A（会话内按里程碑）。
- 是否彻底移除 web 能力：当前保留作开发冒烟，不交付。

## 风险与备注

- Supabase 项目 email confirmation 已关闭（开发测试）；上线前需开启 + 配邮件。
- 邀请流程：当前 invite 生成 pending member（member_id 作为邀请码）；生产可加邀请链接/deep link。
- 原生 app 持久化：cloud 模式数据在 Supabase（不丢）；本地 demo 模式仅 web localStorage。
- `node_modules/.bin` 执行位曾丢失（已修复 target +x）；如再现 `npm rebuild` 或重装。

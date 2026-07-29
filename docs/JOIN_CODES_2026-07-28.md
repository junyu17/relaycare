# 家庭 6 位加入码 + 匿名成员 + 成员管理（2026-07-28）

> 仅 coordinator 用邮箱注册；其他成员扫码/输 6 位码匿名加入；coordinator 可移除成员/解散家庭，普通成员只能退出。
> 验证：tsc 0 · eslint 0/0 · prettier 全过 · vitest 30/30。

## 后端 `0014_join_codes.sql`

- `household_codes` 表：6 位码、15 分钟过期、状态（active/locked/used），活跃码全局唯一（避免歧义）。RLS 锁定，客户端不可直读。
- `join_attempts` 表：每设备 15 分钟窗口最多 5 次尝试（防枚举）。
- `generate_household_code()`：协调人生成新码（旧码作废），冲突重试。
- `get_household_code()`：取当前有效码。
- `join_by_code(code, display_name?)`：匿名/已登录成员凭码加入 -> 校验码 + 过期 + 限流 + 成员上限(Free 3/Plus 12) + 防重复 -> 建 caregiver 成员 + 设活跃家庭 + 审计。
- `leave_household(household_id)`：普通成员退出自己（协调人不可，须解散）。
- `remove_member(member_id)`：协调人移除成员（不能移除自己）。
- `dissolve_household()`：协调人解散家庭（级联删除全部数据）。
- `config.toml`：`enable_anonymous_sign_ins = true`。

## 客户端

- `src/lib/db.ts`：`generateHouseholdCode` / `getHouseholdCode` / `joinByCode` / `leaveHousehold` / `removeMember` / `dissolveHousehold` 封装。
- `src/auth/AuthContext.tsx`：`joinByCode`（先 `signInAnonymously` 再凭码加入）；深链 `taskkin-care://join?code=XXXXXX` 捕获。
- `src/auth/AuthScreen.tsx`：新增"用 6 位码加入"模式（匿名，无需邮箱）；OnboardingScreen Join 改用 6 位码。
- `src/components/QRCode.tsx`：纯 JS 二维码（qrcode-generator，无原生依赖），编码 `taskkin-care://join?code=XXXXXX`。
- `src/App.tsx` Settings：
  - 协调人："家庭加入码"面板（QR + 6 位码 + 到期 + 复制 + 刷新/生成）；成员卡片加"移除"。
  - 协调人底部："解散家庭"；普通成员底部："退出家庭"。
  - 移除旧的 per-role 邀请模板（改为家庭码统一加入，加入后 coordinator 改角色）。
- `src/types.ts` + i18n：新增审计动作 `member.joined` / `member.removed` / `member.left` / `household.dissolved`（三语）。

## 加入流程

1. 协调人 Settings -> "生成加入码" -> 显示 QR + 6 位码（15 分钟有效）。
2. 成员：系统相机扫 QR（深链打开 app 预填码）或手输 6 位码 + 可选姓名。
3. app 匿名签到 -> `join_by_code` -> 建成员（caregiver）+ 设活跃家庭 -> 进入家庭。
4. 协调人可改成员角色 / 移除成员 / 解散家庭；成员可退出自己。

## 安全

- 6 位码 + 15 分钟过期 + 活跃码唯一。
- 每设备 5 次/15 分钟限流（防枚举）；码本身作废后不可用。
- 匿名身份设备绑定（Supabase anonymous auth，refresh token 绑定设备）。
- 移除/解散/退出均走 service-definer RPC + 审计；协调人不可直接退出（须解散）。

## 需部署

1. 执行 `0014_join_codes.sql`。
2. Supabase Dashboard -> Authentication -> Providers -> Anonymous -> **启用匿名登录**（config.toml 已改 `enable_anonymous_sign_ins = true`，云端需在 Dashboard 同步开启）。
3. 重新 build iOS（qrcode-generator 纯 JS，无需 prebuild；但若之前 prebuild 过，JS 变更在运行时生效）。

## 注意

- 旧 invite_token 流程（accept_invite）保留未删（向后兼容，UI 已改用码加入）。
- 匿名成员后续可由 coordinator 改为 caregiver/viewer；匿名账号可后续转正式账号（Supabase linkIdentity，未来增强）。

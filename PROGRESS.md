# RelayCare MVP 进度跟踪

> 项目总负责人视角的实时状态文件。每次有进展或遇到待决策项时更新。
> 最后更新：2026-07-23

## 当前阶段

A2 + B3 + C1 **全部完成**，全量验证通过，已首次提交。待用户确认两件事后结项：

1. 30 分钟汇报机制（方案 A/B/C，见下）。
2. 是否需要彻底移除 web 能力（当前仅作开发冒烟，不交付）。

## 交付约束（用户重申，已落实）

- **无网页端**：交付物为 RN app（iOS/Android）；`web-build/` 已 `.gitignore`，不纳入交付；`expo export --platform web` 仅作 headless 构建冒烟。
- **设置全在 app 内**：角色管理、邀请、通知、审计入口均在 Settings tab，无外部管理端。
- **权限差异化界面**：`canAccessTab` 按 role 过滤底栏 tab；coordinator 可见审计入口，caregiver 不可见，viewer 仅 home/timeline/settings。

## 已完成

### 阶段 0：独立审计 + 编译修复 ✅

- 独立复核 07-22 旧审计清单 vs 当前源码。
- 修复 P0 回归：`domain.ts` `memberName` 缺闭合 `}` -> 项目无法编译。已补 `}`。

### 阶段 1：C1 小修 ✅

- P2#13 a11y `Act as` 硬编码 -> `t("member.actAs", {name})`，三语 key 已加。
- P2#12 邀请过期：`domain.isHouseholdInviteExpired` 纯函数；`onInviteMember` 过期拦截 + 本地化提示；Settings 过期提示。
- P1#8 周报漂移：生成时按三语快照 `reportText: Record<Language,string>`，删除随 state 重建的 useEffect。
- i18n 新增 key（member.actAs / alerts.inviteExpired* / settings.inviteExpiredNotice / settings.viewAllAudit / audit.back）三语齐全（已逐项核实 en/zh/es）。

### 阶段 2：A2 审计页 + 删死码 ✅

- 删除 `domain.generateWeeklyReport` 死函数（grep 已确认无残留）。
- 删除 `App.tsx` `renderReport` 死函数；`TabKey` 移除 `"report"`（grep 已确认无残留）。
- `renderAudit` 改为可达：Settings 内「查看全部审计」入口（`settings.viewAllAudit`），仅 `audit:read`（coordinator）可见，带返回按钮（`audit.back`）。

### 阶段 3：B3 工程化基线 ✅

- `git init` + `.gitignore` 核对 + 首次提交 `469ff27`（项目独立仓库，toplevel = relaycare-mvp，脱离 ~/ 家目录 git）。
- vitest + `src/__tests__/domain.test.ts`（17 项，覆盖权限/认领/交接/审计/邀请过期/ID 唯一性）。
- ESLint flat config（`eslint.config.js`）+ Prettier（`.prettierrc`）。
- npm scripts：typecheck / lint / lint:fix / test / test:watch / format / format:check。

### 阶段 4：全量验证 ✅

- `tsc --noEmit`：0 错误。
- `vitest run`：17/17 通过。
- `eslint .`：0 error 0 warning（修复了 2 个 set-state-in-effect error：hydration 改 lazy initializer 消除 effect；权限守卫 effect 加带说明的 disable；exhaustive-deps warning 通过精确依赖/handoffCandidates 改 `[actor.id, state]` 消除）。
- `prettier --check .`：全部通过。
- `expo export --platform web`：构建通过，bundle 987KB。
- Headless Chrome 渲染冒烟：DOM 24,767 bytes，含 RelayCare/Non-PHI/coordinator/Maya/Next actions，hydration lazy init 运行时正常。

## 待用户决策

1. **30 分钟汇报机制**（环境无 pi 心跳/cron，无法在会话外自动定时往本对话发消息）：
   - 方案 A（推荐，会话内）：本会话按里程碑 + 约 30 分钟节奏汇报，直接在对话可见。
   - 方案 B（系统调度器）：装 macOS LaunchAgent，每 30 分钟写 `docs/PROGRESS.log` + macOS 通知（不在本对话显示，需改系统配置）。
   - 方案 C（飞书 bot）：每 30 分钟推送到指定飞书会话（需指定 bot/webhook）。
2. **是否彻底移除 web 能力**：当前 web 依赖（react-dom/react-native-web）保留作开发冒烟，不交付。若要连 web 能力移除，告知我。

## 风险与备注

- 邀请过期日期 `2026-07-24T08:30:00-07:00`；当前未过期，demo 不受影响，过期后自动拦截新邀请。
- 持久化仅在 web/localStorage 环境；原生 app 无持久化（MVP 已知限制，非本次范围）。
- `web-build/` 由本次重新构建覆盖（旧 07-22/07-23 产物作废），但已 gitignore 不进版本库。

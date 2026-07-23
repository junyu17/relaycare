# RelayCare MVP 进度跟踪

> 项目总负责人视角的实时状态文件。每次有进展或遇到待决策项时更新。
> 最后更新：2026-07-23

## 当前阶段

A2 + B3 + C1 实施（用户已批准方案）。

## 已完成

### 阶段 0：独立审计 + 编译修复（已完成 ✅）

- 独立复核 07-22 旧审计清单 vs 当前源码。
- 修复 P0 回归：`domain.ts` `memberName` 缺闭合 `}` -> 项目无法编译。已补 `}`。
- `tsc --noEmit` 0 错误；`expo export --platform web` 984KB 通过；无头 Chrome 渲染冒烟通过。
- QA 记录写入 `docs/QA_Log.md`。

### 阶段 1：C1 小修（进行中 🟡）

- [x] P2#13 a11y `Act as` 硬编码 -> 改用 `t("member.actAs", {name})`，三语 key 已加。
- [x] P2#12 邀请过期：`domain.isHouseholdInviteExpired` 纯函数已加；`onInviteMember` 已加过期拦截 + 本地化提示。
- [x] P1#8 周报漂移：改为生成时按三语快照 `reportText: Record<Language,string>`，删除随 state 重建的 useEffect。
- [x] i18n 新增 key（member.actAs / alerts.inviteExpired* / settings.inviteExpiredNotice / settings.viewAllAudit / audit.back）三语齐全。

### 阶段 2：A2 审计页 + 删死码（进行中 🟡）

- [x] 删除 `domain.generateWeeklyReport` 死函数。
- [ ] App.tsx：`renderAudit` 改为可达（Settings 内"查看全部审计"入口，仅 audit:read=coordinator 可见），加返回按钮。
- [ ] App.tsx：删除 `renderReport` 死函数；TabKey 移除 "report"。
- 验证：纯 app 内、按权限差异化（满足用户约束）。

### 阶段 3：B3 工程化基线（待办 ⬜）

- [ ] `git init` + .gitignore 核对 + 首次提交（项目独立仓库，脱离 ~/ 家目录 git）。
- [ ] vitest + `src/__tests__/domain.test.ts`（覆盖权限/认领/交接/审计/邀请过期/ID 唯一性）。
- [ ] ESLint + Prettier 配置。
- [ ] npm scripts：typecheck / lint / test / format。

### 阶段 4：全量验证 + 交付（待办 ⬜）

- [ ] tsc / lint / test / expo export 全绿。
- [ ] 无头 Chrome 渲染冒烟（含审计页、邀请过期、三语）。
- [ ] 双遍 self-check（对照用户原始要求 + 独立复核）。
- [ ] 更新 QA_Log + AUDIT_REPORT，最终交付报告。

## 待用户决策

（当前无阻塞决策；交付机制选项见下方"汇报机制"。）

## 汇报机制（待用户选择）

环境无 pi 心跳/cron。30 分钟定时汇报需装系统调度器，按规则先征同意：

- 方案 1（推荐）：装 macOS LaunchAgent `ai.relaycare.progress`，每 30 分钟读本文件 -> macOS 通知 + 追加 `docs/PROGRESS.log`。我在会话内每个里程碑也同步汇报。
- 方案 2：仅会话内里程碑汇报（无外部调度器；节奏≈我的工作回合，不保证精确 30 分钟）。
- 方案 3：通过你已有的飞书 bot 推送（需指定哪个 bot/会话）。

## 风险与备注

- 邀请过期日期 `2026-07-24T08:30:00-07:00`；当前(07-23)未过期，demo 不受影响，过期后自动拦截新邀请。
- `web-build/` 已由本次重新构建覆盖（旧 07-22 产物作废）。

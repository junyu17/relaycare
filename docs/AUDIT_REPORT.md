# RelayCare MVP 项目审计报告

**审计人**：项目总负责人视角
**审计日期**：2026-07-22
**审计范围**：

- 立项依据：`~/Documents/RelayCare_项目立项/RelayCare_家庭照护协同平台_立项方案_v1.0.pdf`
- 代码库：`~/Documents/Project.app/relaycare-mvp`（Expo RN + TS，5 个源文件，约 5100 行）

---

## 一、验证执行情况

| 检查项                                         | 结果                         |
| ---------------------------------------------- | ---------------------------- |
| `npx tsc --noEmit`                             | ✅ 通过（0 错误）            |
| `npx expo export --platform web`               | ✅ 通过（产物 986KB bundle） |
| 源码全量人工审查（types/domain/data/i18n/App） | ✅ 完成                      |
| 立项方案需求映射核对                           | ✅ 完成                      |
| 自动化单元测试                                 | ❌ 不存在                    |
| 独立 Git 版本控制                              | ❌ 项目目录无 .git           |

---

## 二、立项方案符合性（正面）

MVP 边界遵守良好，未越界：

- ✅ 非 PHI 边界明确，UI 与文档均声明不做诊断/处方/账单/紧急分诊/深度 EMR。
- ✅ 角色/权限模型生效：viewer 被锁定任务/文件/报告/审计入口。
- ✅ 所有写操作写入 `AuditEvent`（认领/拒绝/交接/完成/通知偏好/文档上传/文档确认/文档派生任务/周报生成）。
- ✅ 文档候选字段需人工确认后才创建任务，无自动写入。
- ✅ 关键到期提醒锁定常开；仅摘要可切换并记审计。
- ✅ 三语国际化 EN/中文/ES。
- ✅ Web 端本地持久化（版本化 key，按 schema 归一化）。
- ✅ 交接改为应用内选择器，候选按 `task:claim` 权限过滤。

---

## 三、缺陷清单（按严重度）

### P0 — 影响试点质量，建议上线前修复

#### 1. 邀请成员名称的本地化缺陷（i18n Bug）

- **位置**：`domain.ts` L435-436（`inviteMember`）、L35-40（`memberName`）；`App.tsx` L1539-1544（`memberDisplayName`）
- **现象**：`inviteMember` 在创建时把名称存为**当前语言的翻译串**（`text(t, "member.invitedCaregiver", ...)`）。而 `memberName`/`memberDisplayName` 只与英文硬编码字面量 `"New caregiver invite"` / `"New viewer invite"` 比较来重新本地化。
- **后果**：若在中文/西班牙语环境下创建邀请，存入的 `name` 是中文/西语；切换回英文后，比较失败，成员名不再随语言切换，始终显示创建时的语言。
- **修复方向**：名称存储与语言解耦——用角色标记 + 固定 sentinel（如 `"__invited_caregiver__"`）或新增 `member.inviteRole` 字段，渲染时再本地化。

#### 2. 实体 ID 碰撞风险

- **位置**：`domain.ts` L171/298/338/429/490/508/553（`task-`/`event-`/`doc-`/`member-` 均为 `Date.now()` 无随机后缀）
- **对比**：`audit-*` 与 `note-*` 已带 `-${Math.round(Math.random()*10000)}` 后缀，但 task/event/doc/member 没有。
- **后果**：同一毫秒内两次操作会产生相同 ID（如快速连续完成任务、连续确认文档），导致 React key 冲突、状态覆盖、审计关联错乱。
- **修复方向**：统一所有动态 ID 加随机后缀，或改用 `crypto.randomUUID()`。

#### 3. 交接候选包含未接受的待邀请成员

- **位置**：`App.tsx` L140-143 `handoffCandidates`
- **现象**：只过滤 `task:claim` 权限，未排除 `inviteStatus === "pending"`。
- **后果**：可把任务交接给一个尚未接受邀请的待加入成员，违反"待设置"语义，且该成员无法登录接收。
- **修复方向**：`handoffCandidates` 增加 `&& member.inviteStatus !== "pending"`。

---

### P1 — 健壮性与一致性

#### 4. 持久化空 members 导致崩溃

- **位置**：`App.tsx` L2029 `normalizePersistedAppState`、L129 `actor`
- **现象**：`members: Array.isArray(value.members) ? value.members : initialState.members` 接受空数组 `[]`。若 localStorage 中 members 为 `[]`，`state.members[0]` 为 `undefined`，`actor` 变 `undefined`，访问 `actor.role`/`actor.name` 崩溃。
- **修复方向**：空数组时回退 `initialState.members`，或对 `actor` 做空值守卫。

#### 5. 完整 Audit / Report 页面不可达（死代码）

- **位置**：`App.tsx` L430-431 `renderReport`/`renderAudit` 调用；`tabs` 数组仅 5 项
- **现象**：简化导航后，`tabs` 不含 `report`/`audit`，`activeTab` 永不可能为这两值，`renderReport`/`renderAudit` 为死代码。审计仅以 Settings 内 4 条紧凑列表呈现（`recentAuditEvents.slice(0,4)`）。
- **后果**：审计优先是立项硬要求；协调人只能看最近 4 条审计，无法查看完整审计轨迹。代码层面有未可达分支。
- **修复方向**（二选一，见文末决策点）：
  - A：删除死代码，保留 Settings 内 4 条紧凑审计（接受 MVP 限制，文档标注）。
  - B：在 Settings 内增加"查看全部审计"入口跳转完整审计页。

#### 6. 两套周报生成函数（死代码）

- **位置**：`domain.ts` `generateWeeklyReport`（英文硬编码，未使用）；`App.tsx` `generateLocalizedWeeklyReport`（实际使用）
- **修复方向**：删除 `domain.ts` 中未使用的 `generateWeeklyReport`，避免后续误改。

#### 7. 上传流程校验顺序不一致

- **位置**：`App.tsx` `onPickDocument`（L215 权限→L220 安全）vs `onAddSampleDocument`（L238 安全→L241 权限）
- **修复方向**：统一为同一顺序（建议权限→安全），抽公共守卫。

#### 8. 周报文本生成后随状态漂移

- **位置**：`App.tsx` report 重建 useEffect
- **现象**：周报生成后，只要 `state` 变化就重建报告文本；但审计只在生成那一刻写一次。显示的报告可能与审计快照不一致。
- **修复方向**：生成时快照报告文本，不再随 state 重建；或明确标注"实时刷新"。MVP 可接受，但需文档说明。

---

### P2 — 工程流程与卫生

| #   | 问题                                                                        | 建议                                     |
| --- | --------------------------------------------------------------------------- | ---------------------------------------- |
| 9   | **项目无独立 Git 仓库**（检测到的 git 是 `~/` 家目录，非本项目）            | 项目根 `git init` + 首次提交 + 远程仓库  |
| 10  | **无自动化测试**，QA 全靠手动 Playwright                                    | 为 `domain.ts` 纯函数加 vitest/jest 单测 |
| 11  | **无 ESLint/Prettier**，质量门仅 typecheck                                  | 加 lint + format 到 CI                   |
| 12  | **邀请过期未强制**：`inviteExpiresAt` 仅展示不校验（立项 P0 要求 48h 有效） | MVP 可暂缓，标注为已知限制               |
| 13  | **无障碍标签硬编码英文**：`Act as ${name}` 未本地化                         | 立项要求 a11y + i18n，补翻译 key         |
| 14  | **多时区**：时间存 ISO 偏移，但显示用浏览器时区，未按成员时区转换           | 立项提及多时区，MVP 可暂缓               |

---

## 四、总体结论

代码质量在 MVP 脚手架层面**合格偏上**：类型安全、构建通过、权限与审计模型正确、非 PHI 边界守得住。但存在 **3 个 P0 缺陷**（邀请名称 i18n、ID 碰撞、交接候选含待邀请成员）需在试点前修复，以及若干健壮性与工程流程短板（无版本控制、无测试、死代码）。

立项方案的核心 P0 能力（家庭/权限/任务/时间线/通知/周报/文档确认/审计）均有对应实现，边界遵守严格。主要差距在工程化而非产品定义。

---

## 五、待决策点（需用户选择）

**决策点 A：P0 缺陷修复范围**

- 方案 1：仅修 3 个 P0（最小改动，约 30 分钟）
- 方案 2：修全部 P0+P1（含死代码清理与守卫，约 1.5 小时）
- 方案 3：P0+P1+P2 工程化（含 git 初始化、单测骨架、lint，约半天）

**决策点 B：完整审计页处理**

- 方案 1：删除死代码，保留 4 条紧凑视图（维持现状）
- 方案 2：恢复可达的完整审计页（满足"审计优先"要求）

---

## 六、2026-07-23 状态更新（A2 + B3 + C1 完成后）

用户已批准 A2 + B3 + C1 方案并完成实施。各缺陷当前状态：

### P0（07-23 早期已修复，本次复核仍为 FIXED）

| #   | 缺陷                   | 当前状态                                                          |
| --- | ---------------------- | ----------------------------------------------------------------- |
| 1   | 邀请成员名称 i18n 缺陷 | ✅ FIXED（语言中性 sentinel + 渲染时本地化，三语齐全）            |
| 2   | 实体 ID 碰撞           | ✅ FIXED（`uniqueId` 统一加随机后缀，vitest 覆盖）                |
| 3   | 交接候选含待邀请成员   | ✅ FIXED（`handoffCandidates` 过滤 `inviteStatus !== "pending"`） |

### P1

| #   | 缺陷                      | 当前状态                                                                                                    |
| --- | ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 4   | 持久化空 members 崩溃     | ✅ FIXED（`normalizePersistedAppState` 空数组回退 + `actor` 空值守卫）                                      |
| 5   | Audit/Report 死代码不可达 | ✅ FIXED（A2：`renderReport` 删除；`renderAudit` 从 Settings「查看全部审计」入口可达，仅 coordinator 可见） |
| 6   | 两套周报函数死代码        | ✅ FIXED（A2：`domain.generateWeeklyReport` 删除）                                                          |
| 7   | 上传校验顺序不一致        | ✅ FIXED（权限 -> 安全统一顺序）                                                                            |
| 8   | 周报文本随状态漂移        | ✅ FIXED（C1：生成时三语快照 `Record<Language,string>`，移除 state 重建 useEffect）                         |

### P2

| #   | 缺陷                | 当前状态                                                                                  |
| --- | ------------------- | ----------------------------------------------------------------------------------------- |
| 9   | 无独立 Git 仓库     | ✅ FIXED（B3：`git init` + 首次提交 `469ff27`，toplevel = relaycare-mvp）                 |
| 10  | 无自动化测试        | ✅ FIXED（B3：vitest + 17 项单测）                                                        |
| 11  | 无 ESLint/Prettier  | ✅ FIXED（B3：flat config + Prettier，lint 0 error 0 warning）                            |
| 12  | 邀请过期未强制      | ✅ FIXED（C1：`isHouseholdInviteExpired` 纯函数 + `onInviteMember` 拦截 + Settings 提示） |
| 13  | a11y 标签硬编码英文 | ✅ FIXED（C1：`t("member.actAs", {name})`，三语）                                         |
| 14  | 多时区显示          | ⏸ MVP 暂缓（已知限制，非本次范围）                                                        |

### 工程化基线 lint 修复说明（本次新增）

- Hydration：mount effect 内 `setState` -> 改为 lazy `useState(() => loadPersistedAppState())`，消除 effect 并移除 `stateHydrated` 标志（行为等价或更优，无首次默认 state 闪烁）。
- Tab 守卫 effect：保留为 effect 以覆盖所有 role/tab 变化路径，加 `eslint-disable-next-line react-hooks/set-state-in-effect` + 注释说明。
- `handoffCandidates`：依赖改为 `[actor.id, state]` 满足 exhaustive-deps 且保持正确。

### 最终验证（全绿）

`tsc --noEmit` 0 错误 · `vitest run` 17/17 · `eslint .` 0/0 · `prettier --check` 全过 · `expo export --platform web` 构建通过 · Headless Chrome 渲染冒烟通过。

### 待用户决策

1. 30 分钟汇报机制（会话内 / LaunchAgent / 飞书 bot）。
2. 是否彻底移除 web 能力（当前仅作开发冒烟，不交付）。

# TaskKin Care — iOS 提审整改：开发要求与测试验收

制定日期：2026-08-03
基线：`main` / `d3fcb14`
上游依据：[IOS_SUBMISSION_AUDIT_2026-08-03.md](./IOS_SUBMISSION_AUDIT_2026-08-03.md)
执行方：Codex　　复审方：Claude
产品决策：**方案 A2**（补齐全部 Plus 权益实现 + 套餐门禁）+ **方案 B1**（本次不支持 iPad）

---

## 0. 总体约束（每一项都必须遵守）

| #   | 约束                                | 说明                                                                                                                   |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| C1  | **不要直接改 `ios/` 和 `android/`** | 两者已在 `.gitignore`，属 CNG 产物，`expo prebuild` 会覆盖。所有原生配置改 `app.json` 或 `plugins/` 下的 config plugin |
| C2  | **i18n 三语同步**                   | 任何新增文案必须同时补 `en` / `zh` / `es`，缺一不可。新增后必须能通过 R2-3 的 key 完整性测试                           |
| C3  | **服务端是权威**                    | 客户端套餐判断只用于 UX 预检；任何"Plus 才能做"的写操作必须在 RPC / Edge Function 内再校验一次 `effective_plan()`      |
| C4  | **非 PHI 边界不得放宽**             | 导出文件只走系统分享面板，禁止上传到任何第三方；OCR 保持 on-device                                                     |
| C5  | **每项功能必须带单测**              | 纯逻辑（配额、CSV 序列化、报表聚合、i18n 完整性）一律进 `src/__tests__/`。Vitest 不跑 RN 组件，UI 层用手工 QA 覆盖     |
| C6  | **门禁必须全绿**                    | `npm run typecheck && npm run lint && npm run test && npm run format:check`                                            |
| C7  | **迁移号连续**                      | 当前最新为 `0035`。新迁移从 `0036` 起，一个逻辑主题一个文件，不得改写已有迁移                                          |
| C8  | **commit 粒度**                     | 一个需求 ID 一个 commit，message 前缀 `feat(ios):` / `fix(ios):` / `chore(ios):`，正文注明需求 ID                      |

---

## 1. 需求清单总览

| ID  | 标题                                                  | 优先级 | 主要改动面                                      |
| --- | ----------------------------------------------------- | ------ | ----------------------------------------------- |
| R1  | Edge Function 接受 Sandbox 环境                       | P0     | 运维配置 + `backend/qa/DEPLOY.md`               |
| R2  | 补齐缺失的 audit i18n key + 类型 + 完整性测试         | P0     | `src/i18n.ts`、`src/types.ts`、新单测           |
| R3  | 付费墙内加条款/隐私可点击链接                         | P0     | `src/paywall/Paywall.tsx`、`src/App.tsx`        |
| R4  | 报表导出 PDF / CSV（Plus 专属）                       | P1     | 新增依赖 + `src/lib/export/`、`src/App.tsx`     |
| R5  | 摘要与静默时段（Plus 专属，含服务端门禁）             | P1     | 迁移 0036 + `src/lib/actions.ts`、`src/App.tsx` |
| R6  | 自动周报 + 历史（Plus 专属）                          | P1     | 迁移 0037 + `src/lib/db.ts`、`src/App.tsx`      |
| R7  | 审计保留期真正生效（30 天 / 3 年）                    | P1     | 迁移 0038（pg_cron 调度）                       |
| R8  | 统一套餐门禁入口 + 付费墙对照一致性测试               | P1     | `src/lib/entitlement.ts`、新单测                |
| R9  | `app.json` 原生配置整改（iPad / 导出合规 / 推送权限） | P1     | `app.json`、可能新增 config plugin              |
| R10 | 免责文案价格改为注入 StoreKit 实际价格                | P1     | `src/i18n.ts`、`src/paywall/Paywall.tsx`        |
| R11 | dev 解锁按钮加 `__DEV__` 守卫 + 生产配置断言          | P2     | `src/paywall/Paywall.tsx`、`src/App.tsx`        |
| R12 | `findPrice` 改用平台 SKU                              | P2     | `src/paywall/Paywall.tsx`                       |
| R13 | 订阅周期在按钮上明示                                  | P2     | `src/paywall/Paywall.tsx`                       |
| R14 | 重新采集提审截图（QA 数据整改）                       | P2     | 无代码，QA 操作                                 |

---

## 2. 逐项规格

### R1　Edge Function 接受 Sandbox 环境

**问题**　`backend/supabase/functions/_shared/apple-jws.ts:90` 默认 `{"Production"}`，App Review 与 TestFlight 均走 Sandbox，导致审核员无法完成购买。

**要求**

1. 部署侧设置 secret（不改代码默认值，保持"默认最严"的设计）：
   ```bash
   supabase secrets set APPLE_ACCEPTED_ENVIRONMENTS=Production,Sandbox
   supabase functions deploy verify-apple-receipt
   ```
2. `backend/qa/DEPLOY.md` 增加一节 **"提审前必须确认的 secrets"**，把上述命令、原因（审核走 Sandbox）、以及"长期保留双环境"的结论写清楚。
3. `verify-apple-receipt/index.ts` 启动时 `console.log` 一次生效的 `ACCEPTED_ENVIRONMENTS`，便于线上确认（不含任何密钥）。
4. `apple-server-notifications` / `verify-google-purchase` 若有同类环境判断，一并核对并在文档中说明。

**验收 AC**

- AC1-1　线上 `verify-apple-receipt` 日志中可见 `acceptedEnvironments: ["Production","Sandbox"]`。
- AC1-2　用沙盒 Apple ID 在真机完成一次年付订阅，函数返回 `{ok:true, plan:"yearly"}`，`households.plus_plan` 被写为 `yearly`。
- AC1-3　`DEPLOY.md` 中该节存在且命令可直接复制执行。

---

### R2　补齐缺失的 audit i18n key + 类型 + 完整性测试

**问题**　服务端写入的 3 个 audit action 在 `src/i18n.ts` 中无对应 key，`makeTranslator` 兜底 `?? key`，UI 直接显示 `audit.task.deleted` 等字面量（已出现在提审截图中）。

**缺失清单**

| action                   | 来源迁移                                           | 需补 key                                                               |
| ------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------- |
| `task.deleted`           | `0017_delete_task_timeline.sql:25`                 | `audit.task.deleted` + `audit.detail.task.deleted`                     |
| `timeline.event_deleted` | `0017_delete_task_timeline.sql:51`                 | `audit.timeline.event_deleted` + `audit.detail.timeline.event_deleted` |
| `member.name_updated`    | `0018_update_my_name.sql:21`（0022 / 0031 亦写入） | `audit.member.name_updated` + `audit.detail.member.name_updated`       |

**要求**

1. `src/i18n.ts` 的 en / zh / es 三个词典各补上表 6 个 key。
2. `src/types.ts:25` 的 `AuditAction` 联合类型补 `"task.deleted" | "timeline.event_deleted" | "member.name_updated"`。
3. **明细模板不得引用 `{title}`**。`src/App.tsx:3071` 的 `title` 在实体已被删除时会回落成服务端写死的英文 detail 字符串，插进模板会把整句英文塞进中文界面。删除类明细只用 `{actor}`：
   - en：`"{actor} deleted a task."` / `"{actor} deleted a timeline entry."` / `"{actor} updated their display name."`
   - zh / es 同义翻译。
4. 新增单测 `src/__tests__/i18n.test.ts`：
   - 遍历 `AuditAction` 每个成员，断言 `audit.<action>` 在 en / zh / es 三个词典中都存在且非空；
   - 断言三个词典的 key 集合完全一致（防止今后单语漏补）；
   - 断言不存在 value 等于自身 key 的条目。

**验收 AC**

- AC2-1　设置页 → View all audit events，删除一个任务与一条 timeline 后，列表显示的是人话标题而非 `audit.*` 字面量；zh / es 下同样为对应语言。
- AC2-2　`src/__tests__/i18n.test.ts` 通过；故意删掉任一语言的一个 key 时该测试必须失败（请在 PR 描述中说明你验证过这一点）。
- AC2-3　`npm run typecheck` 通过（类型联合已补齐）。

---

### R3　付费墙内加条款 / 隐私可点击链接

**问题**　Guideline 3.1.2 要求在购买点提供可点击的 EULA 与隐私政策链接；当前只有设置页有。

**要求**

1. `Paywall` 组件新增 `language: Language` prop；`src/App.tsx` 渲染处传入当前 `language`。
2. 在 `paywall.disclosure` 文本下方新增一行两个链接按钮，调用现成的 `openLegal(kind, language)`（`src/legal/consent.ts:35`）。
3. 无障碍：`accessibilityRole="link"`，`accessibilityLabel` 用已有的 `settings.openTerms` / `settings.openPrivacy`。
4. 视觉：teal 色下划线文字，位于 disclosure 与"管理订阅"之间，Free / Plus 两种状态下**都必须可见**。

**验收 AC**

- AC3-1　付费墙（Free 状态、Plus 状态）均可见两个链接。
- AC3-2　点击分别打开 `https://junyu17.github.io/relaycare/terms*.html` 与 `privacy*.html`，且随 App 语言切换到 `-zh` / `-es` 版本。
- AC3-3　VoiceOver 能读出链接名称。

---

### R4　报表导出 PDF / CSV（Plus 专属）

**问题**　付费墙宣称 Plus 解锁 "Export (PDF/CSV)"，但代码中没有任何 PDF / CSV 实现，"导出"实为纯文本 `Share.share`（`src/App.tsx:686`），且未按套餐门禁。

**要求**

**依赖**（需 `expo prebuild` 后重新构建）

```
expo-print         # PDF：printToFileAsync(html)
expo-file-system   # CSV：写入 cacheDirectory
expo-sharing       # 系统分享面板
```

**新增模块 `src/lib/export/`（纯逻辑，可单测）**

- `csv.ts`
  - `toCsv(rows: string[][]): string`
  - 规则：字段含 `,` `"` 换行时用双引号包裹并把 `"` 转义为 `""`；行分隔用 `\r\n`；文件头写 UTF-8 BOM（`﻿`）保证 Excel 中文不乱码。
  - **CSV 注入防护**：字段首字符为 `= + - @ \t \r` 时前置单引号 `'`。必须有对应单测。
- `report.ts`
  - `buildTaskCsvRows(state, t): string[][]` —— 表头 + 每个任务一行，列：`Task ID, Title, Status, Owner, Owner role, Priority, Due at (ISO), Created at (ISO), Completed at (ISO)`。
  - `buildReportHtml(state, actor, language, t): string` —— 复用 `buildLocalizedReportText` 的同一套聚合数据，输出内联样式的 A4 HTML（无外链资源、无远程字体）。
  - 文件名：`taskkin-weekly-report-YYYY-MM-DD.pdf` / `taskkin-tasks-YYYY-MM-DD.csv`（日期取家庭时区当天）。

**UI**

- 报表弹窗 header（`src/App.tsx:1155` 附近）把当前单个 share 图标扩展为三个动作：`Share text` / `Export PDF` / `Export CSV`。
- **门禁**：`planLimits(state.household).exportEnabled === false` 时，PDF / CSV 两个按钮显示为带锁图标的置灰态，点击直接打开付费墙（`setPaywallVisible(true)`），不弹 Alert。
- Share text 保持对 Free 开放（这是现有能力，不能倒退）。
- 导出成功后写一条 audit：新增 action `report.exported`（需同步补 `AuditAction`、`audit.report.exported`、`audit.detail.report.exported` 三语 key，并纳入 R2 的完整性测试）。

**边界**

- `Sharing.isAvailableAsync()` 为 false 时提示 `export.unavailable`（新增三语文案），不得崩溃。
- 导出文件写入 `FileSystem.cacheDirectory`，分享完成后不主动删除（由系统回收），但**不得**写入 documentDirectory 造成 iCloud 备份膨胀。
- 任务数为 0 时 CSV 仍输出表头行。

**验收 AC**

- AC4-1　Free 家庭：PDF / CSV 按钮置灰，点击弹出付费墙；Share text 正常。
- AC4-2　Plus 家庭：Export PDF 生成可打开的 PDF，内容与弹窗文本一致，中/英/西三语各验一次，中文不出现方块字。
- AC4-3　Plus 家庭：Export CSV 用 Numbers / Excel 打开，列对齐，中文正常，无公式被执行。
- AC4-4　单测覆盖：`toCsv` 的引号/逗号/换行/注入四类用例；`buildTaskCsvRows` 的空列表与含特殊字符标题用例。
- AC4-5　导出后审计列表出现一条本地化的"导出报表"记录。

---

### R5　摘要与静默时段（Plus 专属，含服务端门禁）

**问题**　`PLAN_LIMITS.advancedNotifications` 在 `src/` 中除测试外零引用；digest 开关对 Free 用户同样可用（`src/App.tsx:1693`）；静默时段只读展示、从不生效；`toggleDigest` 走的是直接 `.update()` 表写（`src/lib/actions.ts:180`），服务端无套餐校验。

**要求**

**迁移 `0036_notification_preference_rpc.sql`**

```sql
create or replace function public.update_notification_preference(
  p_member_id uuid,
  p_task_digest boolean,
  p_quiet_hours_start text,
  p_quiet_hours_end text
) returns void
language plpgsql security definer set search_path = public
```

- 校验顺序：`auth.uid()` 非空 → 调用者是该 member 本人**或**同家庭 coordinator → `effective_plan(household_id) in ('monthly','yearly')` 否则 `raise exception 'Family Plus required'` → 时间格式 `^\d{2}:\d{2}$` 且为合法 24 小时值。
- 写入后追加 audit `notification.preference_updated`。
- 权限：`revoke all from public/anon`，`grant execute to authenticated`。
- **同时收紧 RLS**：`notification_preferences` 的 UPDATE 策略改为不允许客户端直写，只能走本 RPC（沿用 0031 的收紧模式）。

**客户端**

- `src/lib/actions.ts` 的 `toggleDigest` 改为调用新 RPC；新增 `updateQuietHours`。
- 新增设置项 UI：Home 的通知控制区，Plus 用户点击齿轮图标打开"通知偏好"弹窗，可切换 digest、设置静默起止时间（两个 24 小时制选择器，步进 30 分钟）。
- Free 用户：该区域显示只读默认值（22:00–07:00，digest on）+ 一个"Family Plus"角标，点击打开付费墙。

**本地通知实际生效**

- 新增 `src/lib/notify.ts`：
  - `isWithinQuietHours(now: Date, start: string, end: string, timezone: string): boolean` —— 必须正确处理跨零点区间（如 22:00–07:00）。
  - `shouldDeliverNow(severity, pref, now)` —— `severity === "critical"` 始终投递；非 critical 且处于静默时段则**不投递**；`taskDigest === true` 时非 critical 一律不即时投递，改为累积。
- `src/App.tsx:1433` 的 `subscribeRoleNotifications` 回调接入上述判定。
- 摘要投递：累积的非 critical 通知存 AsyncStorage（key `taskkin-care:digest-queue`），在静默时段结束时间用 `scheduleNotificationAsync` 排一条汇总通知（标题 `notification.digest.title`，正文 `notification.digest.body` 带 `{count}`）。App 前台恢复时也检查一次队列。
- Free 用户走原有即时投递逻辑，不受影响。

**验收 AC**

- AC5-1　Free 用户在 UI 上无法修改 digest 与静默时段；直接用 REST 调 `update_notification_preference` 返回 `Family Plus required`。
- AC5-2　Free 用户直接对 `notification_preferences` 发 PATCH 被 RLS 拒绝。
- AC5-3　Plus 用户修改静默时段为 `00:00–23:59` 后，触发一条普通角色通知：不弹出；触发一条 critical 通知：立即弹出。
- AC5-4　digest 打开时，连续触发 3 条普通通知不逐条弹出；静默结束时间到达后收到 1 条"3 条更新"汇总通知。
- AC5-5　`isWithinQuietHours` 单测覆盖：不跨零点、跨零点、起止相同、边界值（正好等于 start / end）四类。
- AC5-6　审计列表出现本地化的"通知偏好已更新"记录。

---

### R6　自动周报 + 历史（Plus 专属）

**问题**　付费墙宣称 Plus 解锁"自动 + 历史"，`weeklyReportAuto` 零引用，无任何自动生成与历史存储。

**设计要点**　**数据库只存指标快照，不存文案**，文案由客户端按当前语言渲染 —— 否则自动生成时无法知道用户语言，且会把三语文本冗余进库。

**迁移 `0037_weekly_reports.sql`**

```sql
create table public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  week_start date not null,
  generated_at timestamptz not null default now(),
  generated_by uuid references public.members(id) on delete set null,  -- null = 系统自动
  metrics jsonb not null,   -- {open, completed, ownerRate, criticalOpen, byMember:[{memberId,name,open,completed}]}
  unique (household_id, week_start)
);
```

- RLS：SELECT 限本家庭成员；INSERT / UPDATE / DELETE 一律禁止客户端直写。
- `record_weekly_report(p_household_id uuid, p_metrics jsonb)`：security definer，校验调用者是本家庭 coordinator，`on conflict (household_id, week_start) do update`，并写 audit `report.generated`。
- `list_weekly_reports(p_household_id uuid, p_limit int)`：security definer，**Free 家庭只返回最近 1 条，Plus 返回最多 `p_limit`（上限 52）**。套餐判断在 SQL 内做，不信客户端。
- `generate_weekly_reports()`：security definer，仅 `service_role` 可执行；遍历 `effective_plan(id) in ('monthly','yearly')` 的家庭，聚合上周指标并写入。供 pg_cron 调度。
- pg_cron 调度（放在同一迁移或 0038）：每周一 08:00 UTC 执行 `generate_weekly_reports()`。

**客户端**

- `src/lib/db.ts` 新增 `listWeeklyReports(limit)` / `recordWeeklyReport(metrics)`。
- 现有 `onGenerateReport`（`src/App.tsx:655`）在 cloud 模式下改为：生成本地文案 → 调 `recordWeeklyReport` 落指标 → 刷新历史列表。
- 报表弹窗顶部新增"历史"分段控件：Plus 显示最近 12 周列表（点击某周 → 用该周 metrics 重新渲染当前语言文案）；Free 显示列表但只有当周一条 + 一条"升级查看历史"提示条，点击打开付费墙。

**验收 AC**

- AC6-1　Plus 家庭手动生成两次（跨周需改系统时间或直接插测试数据），历史列表出现两条，切到 zh 后条目文案为中文。
- AC6-2　Free 家庭历史列表只有 1 条 + 升级提示；直接调 `list_weekly_reports(p_limit=52)` 仍只返回 1 条（服务端拦截）。
- AC6-3　非本家庭成员调用 `list_weekly_reports` 返回空或报错，不泄露数据。
- AC6-4　手动执行一次 `select public.generate_weekly_reports();`（service_role）后，所有 Plus 家庭新增上周记录，Free 家庭无新增。
- AC6-5　`select * from cron.job;` 能看到该周任务。

---

### R7　审计保留期真正生效（Free 30 天 / Plus 3 年）

**问题**　`cleanup_old_audit()` 自 0008 就存在（0030 已收权到 service_role），但仓库内**没有任何调度**，保留期差异从未生效。

**要求**

**迁移 `0038_schedule_audit_cleanup.sql`**

- `create extension if not exists pg_cron;`（Supabase 需先在 Dashboard 启用，迁移里做幂等声明并在注释中写明前置条件）。
- 每日 03:00 UTC 调度 `select public.cleanup_old_audit();`。
- 使用 `cron.schedule('taskkin-audit-cleanup', ...)`，并先 `cron.unschedule` 同名任务保证迁移可重复执行。

**验收 AC**

- AC7-1　`select jobname, schedule, command from cron.job where jobname='taskkin-audit-cleanup';` 有且仅有一条。
- AC7-2　构造测试数据：Free 家庭插入一条 `created_at = now() - interval '31 days'` 的 audit，手动执行 `cleanup_old_audit()` 后该行消失；Plus 家庭同样时间的行仍在。
- AC7-3　Plus 家庭插入 `now() - interval '1100 days'` 的行，执行后消失（3 年 = 1095 天）。
- AC7-4　`backend/qa/DEPLOY.md` 写明 pg_cron 需在 Supabase Dashboard 手动启用。

---

### R8　统一套餐门禁入口 + 付费墙对照一致性测试

**问题**　套餐能力散落各处，付费墙表格与实际门禁没有任何机制保证一致，本次审计正是因此发现 4 项虚标。

**要求**

1. `src/lib/entitlement.ts` 新增：
   ```ts
   export type PlusFeature = "export" | "advancedNotifications" | "weeklyReportAuto" | "auditRetention";
   export function canUse(household: Household, feature: PlusFeature): boolean;
   ```
2. R4 / R5 / R6 的客户端门禁统一走 `canUse()`，不得再零散读 `PLAN_LIMITS`。
3. `src/paywall/Paywall.tsx` 的 `ROWS` 每一项增加一个字段，标注它由哪个 `PlusFeature` 或哪个 quota 支撑：
   ```ts
   { labelKey: "paywall.row.export", free: "none", plus: "PDF/CSV", backedBy: "export" }
   ```
4. 新增单测 `src/__tests__/paywall-consistency.test.ts`：遍历 `ROWS`，断言每一行的 `backedBy` 都能在 `PLAN_LIMITS` 中找到 free / plus 取值不同的对应字段。**任何人今后往付费墙加一行卖点，却没有对应门禁，测试立即失败。**

**验收 AC**

- AC8-1　该测试通过；手动往 `ROWS` 加一行假卖点时测试失败。
- AC8-2　`grep -rn "PLAN_LIMITS" src/ --include=*.tsx` 无命中（组件层不再直接读常量）。

---

### R9　`app.json` 原生配置整改

**要求**

1. `ios.supportsTablet` 改为 `false`（产品决策 B1：本次只上 iPhone）。
2. 新增：
   ```json
   "ios": { "infoPlist": { "ITSAppUsesNonExemptEncryption": false } }
   ```
3. **移除推送 entitlement**：本 App 只用本地通知，全仓库无 `getExpoPushTokenAsync` / `getDevicePushTokenAsync`。
   - 先执行 `npx expo prebuild --clean`，检查 `ios/TaskKinCare/TaskKinCare.entitlements`。
   - 若 `aps-environment` 仍被 expo-notifications 自动注入，新增 `plugins/with-no-push-entitlement.js`（`withEntitlementsPlist` 删除该 key），并挂进 `app.json` 的 `plugins`。
   - 不允许改完 `ios/` 就算完成 —— 必须是 prebuild 后仍然干净。
4. `buildNumber` 保持 `"1"`，`version` 保持 `"1.0.0"`。

**验收 AC**

- AC9-1　`npx expo prebuild --clean` 后：`ios/TaskKinCare/TaskKinCare.entitlements` 中**不含** `aps-environment`。
- AC9-2　`ios/TaskKinCare/Info.plist` 含 `ITSAppUsesNonExemptEncryption = false`；`UIDeviceFamily` 不含 `2`（iPad）。
- AC9-3　`xcodebuild -configuration Release` 编译通过；本地通知功能在模拟器上仍正常弹出。

---

### R10　免责文案价格改为注入实际价格

**要求**

- `paywall.disclosure` 三语改为模板：`... Price: {monthlyPrice} per month or {yearlyPrice} per year. ...`
- `Paywall.tsx` 渲染时传入 `findPrice(subs, "monthly") ?? "$9.99"`、`findPrice(subs, "yearly") ?? "$99.99"`。
- 价格未拉到时用兜底值，但此时订阅按钮本来就已被 `productUnavailable` 拦截，不会产生"能买但价格不对"的情况。

**验收 AC**

- AC10-1　把设备 App Store 区域切到日本，付费墙按钮与免责文字中的价格一致（均为 ¥ 价格）。
- AC10-2　断网状态打开付费墙，显示兜底价格，点击订阅提示 `productUnavailable`，不发起购买。

---

### R11　dev 解锁按钮加 `__DEV__` 守卫 + 生产配置断言

**要求**

1. `Paywall.tsx` 的 dev 区块（`!householdId && isCoordinator` 分支）外层加 `__DEV__ &&`；`onSubscribe` 中 `t("paywall.localTest")` 的"Enable Plus (testing)"按钮同样只在 `__DEV__` 下出现。
2. `src/App.tsx` 启动时：`if (!__DEV__ && !isSupabaseConfigured) throw new Error("Production build requires EXPO_PUBLIC_SUPABASE_* ...")` —— 宁可崩也不能发出一个带免费解锁按钮的包。
3. `README.md` 补一句：Release 归档前必须确认 `.env` 存在且已填。

**验收 AC**

- AC11-1　Release 构建中，本地 demo 模式的 dev 按钮不存在（可用 `grep -c "Enable Plus" main.jsbundle` 辅助确认，应为 0）。
- AC11-2　临时移走 `.env` 后 Release 构建启动即报错，而不是静默进入 demo 模式。

---

### R12　`findPrice` 改用平台 SKU

`src/paywall/Paywall.tsx:54` 写死 iOS 产品 ID，导致 Android 恒返回 `null` → 无法订阅。改用 `skuForPlan(plan)`（`src/paywall/iap.ts:25`）。

**验收 AC**：AC12-1　Android 上付费墙能显示 Play 本地化价格并可发起购买流程。

---

### R13　订阅周期在按钮上明示

`paywall.length.monthly` / `paywall.length.yearly` 已定义但零引用。在两个订阅按钮下方各加一行小字显示周期，使"名称 / 周期 / 价格"三要素在按钮区域内同时可见（Guideline 3.1.2）。

**验收 AC**：AC13-1　付费墙截图中，无需阅读长段免责文字即可看到"Family Plus / 1 year / $99.99"。

---

### R14　重新采集提审截图（QA 操作，无代码）

- 演示账号中的成员名 **"Bill Gates"** 必须改成虚构名字（Guideline 5.2.1）。仓库 seed 数据（`src/data.ts`）本身已是虚构名，问题出在真机演示数据，属手工整改。
- 必须在 R2 / R3 / R4 / R13 全部合入后重新截图，确保：审计列表无 `audit.*` 字面量、付费墙含法务链接与周期文案。
- 输出规格：**1320 × 2868**（6.9"，2026 年 ASC 主规格）。备用 1242 × 2688。
- 建议 6 张：Home / Tasks / Timeline / Docs(OCR) / Paywall / Settings。

---

## 3. 测试验收总纲

### 3.1 自动化门禁（必须全绿，附终端输出）

```bash
npm run typecheck && npm run lint && npm run test && npm run format:check
```

新增单测清单：

| 文件                                        | 覆盖                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/__tests__/i18n.test.ts`                | 三语 key 集合一致、AuditAction 全覆盖、无 value===key                         |
| `src/__tests__/export.test.ts`              | `toCsv` 引号/逗号/换行/注入、`buildTaskCsvRows` 空与特殊字符                  |
| `src/__tests__/notify.test.ts`              | `isWithinQuietHours` 跨零点与边界、`shouldDeliverNow` 的 critical/digest 组合 |
| `src/__tests__/paywall-consistency.test.ts` | 付费墙每行卖点都有对应门禁                                                    |
| `src/__tests__/entitlement.test.ts`（扩充） | `canUse()` 四个 feature × free/plus                                           |

### 3.2 服务端越权回归（用真实远端 + 临时账号，跑完清理）

| #   | 场景                                                | 期望                          |
| --- | --------------------------------------------------- | ----------------------------- |
| S1  | Free 用户调 `update_notification_preference`        | `Family Plus required`        |
| S2  | Free 用户 PATCH `notification_preferences` 表       | RLS 拒绝                      |
| S3  | Free 用户调 `list_weekly_reports(p_limit=52)`       | 只回 1 条                     |
| S4  | 非成员调 `list_weekly_reports`                      | 空 / 拒绝                     |
| S5  | 普通成员（非 coordinator）调 `record_weekly_report` | 拒绝                          |
| S6  | `authenticated` 角色调 `generate_weekly_reports`    | 拒绝（仅 service_role）       |
| S7  | `authenticated` 角色调 `cleanup_old_audit`          | 拒绝（0030 已收权，回归确认） |
| S8  | 非 coordinator 调 `verify-apple-receipt`            | `COORDINATOR_REQUIRED`        |

### 3.3 沙盒 IAP 端到端（真机 + 沙盒 Apple ID，必须录屏或截图留证）

1. 全新安装 → 注册（已验证 demo 账号）→ 创建家庭 → 成为 Coordinator。
2. 打开付费墙：确认价格来自 StoreKit、周期可见、条款/隐私链接可点。
3. 购买年付 → `verify-apple-receipt` 返回 ok → 家庭升级为 Plus。
4. 验证 4 项权益全部真实可用：导出 PDF、导出 CSV、修改静默时段并验证抑制、周报历史列表。
5. 删除 App 重装 → 登录 → **恢复购买** → Plus 恢复。
6. 在沙盒中取消订阅 → 等待过期 → 确认降级为 Free 且 4 项权益重新上锁。

### 3.4 三语 UI 走查

en / zh / es 各走一遍：Home / Tasks / Timeline / Docs / Settings / Audit / Paywall / Report 弹窗 / 通知偏好弹窗。检查项：无 `audit.*` 或任何 key 字面量、无文字截断、动态字体放大到最大档不破版。

### 3.5 原生构建验证

```bash
npx expo prebuild --clean
cd ios && xcodebuild -workspace TaskKinCare.xcworkspace -scheme TaskKinCare \
  -configuration Release -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' build
```

需 `** BUILD SUCCEEDED **`，并按 AC9-1 / AC9-2 检查产物。

---

## 4. 交付要求

Codex 完成后需提交一份 `docs/IOS_SUBMISSION_REMEDIATION_<日期>.md`，逐条对应本文档的 **R1–R14** 与 **AC**，每条写明：

- 状态：完成 / 部分完成 / 未做（未做必须写原因）
- 证据：文件路径 + 行号、终端输出片段、截图路径、SQL 查询结果
- 偏离：任何与本规格不一致的实现，必须显式列出并说明理由

**不接受**"已完成"三个字而无证据的条目 —— 复审会逐条按 AC 实测。

## 5. 复审时会重点核的点（提前告知，减少返工）

1. R2 的 i18n 完整性测试是否真的会失败（我会手动删 key 验证）。
2. R5 / R6 的套餐门禁是否**只在客户端**做了 —— 我会直接用 REST 打 RPC 验证服务端拦截。
3. R4 的 CSV 注入防护是否真的生效。
4. R9 是否在 `expo prebuild --clean` **之后**仍然干净（而不是手改 `ios/`）。
5. R8 的一致性测试是否形同虚设（`backedBy` 是否真的被断言使用）。
6. 付费墙表格与实际可用功能逐行对照 —— 这是本次 NO-GO 的根因，不接受再次虚标。

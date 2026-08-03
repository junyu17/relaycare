# TaskKin Care — iOS 整改复审（第 2 轮）

复审日期：2026-08-03
复审范围：`d3fcb14..2fa5b1c`（15 个 commit，25 个文件，+945 / −168）
依据：[IOS_SUBMISSION_DEV_SPEC_2026-08-03.md](./IOS_SUBMISSION_DEV_SPEC_2026-08-03.md) 的 R1–R14 与 AC
复审人：Claude（Opus 5）

## 结论

**仍为 NO-GO。** 7 项阻断、6 项高、3 项中。

自动化门禁全绿（typecheck / lint / 47 tests / prettier），但**绿灯掩盖了三类问题**：功能只做了一半（R4 无 PDF、CSV 非文件）、模块写好却没接线（R5 的 `notify.ts` 零引用、R6 的 `record_weekly_report` 零调用）、以及一处必然运行时报错的 SQL（引用了不存在的列）。

R1 / R2 / R3 / R7 / R9 / R10 / R11 / R12 / R13 完成质量好。0037 与 0039 两个补漏迁移是超出规格的主动自查，值得肯定。

---

## 一、阻断项

### B1　`generate_weekly_reports()` 引用不存在的列 `tasks.completed_at`

`0038_weekly_reports.sql:110` 与 `0039_harden_weekly_reports.sql:37` 都查询 `t.completed_at`。
但 `tasks` 表（`0001_init_schema.sql:78-95`）**没有这一列**，全仓库（含 `all_in_one.sql`）也没有任何迁移添加它：

```
grep -rn "completed_at" backend/   →  只有 0038 / 0039 两处引用，零处定义
```

plpgsql 延迟编译，`create function` 会成功，**首次执行即 `column t.completed_at does not exist`**。
后果：自动周报永远不会生成，AC6-4 必然失败；而 pg_cron 每周一静默失败，不会有人发现。

**修复（二选一）**

- 加迁移给 `tasks` 增加 `completed_at timestamptz`，并在完成任务的 RPC 里写入（注意历史数据回填为 null）。
- 或改用 `audit_events` 统计：`where action = 'task.completed' and created_at >= ...`，无需改表。

### B2　付费墙仍宣称 PDF，但 PDF 完全没有实现

- `src/paywall/paywallRows.ts:18` → `{ labelKey: "paywall.row.export", plus: "PDF/CSV" }`
- 新增的 `paywall.exportReports` 三语文案同样写着 "(PDF/CSV)" / "（PDF/CSV）"
- 代码中无 `expo-print`、无 `printToFileAsync`、无 `buildReportHtml`；`package.json` 未新增任何依赖

**这正是本次 NO-GO 的根因，原封不动地留着。** Guideline 3.1.2 / 2.3.1。

**修复（二选一）**

- 按 R4 实现 PDF（`expo-print` + `expo-sharing`）。
- 或把付费墙与 i18n 文案统一改成 "CSV"，本次不卖 PDF。

### B3　CSV 不是文件，是纯文本消息

`src/App.tsx:715` `await Share.share({ title, message: csv })` —— 分享出去的是一段**文本**，不是 `.csv` 附件。
用户无法"用 Numbers / Excel 打开"，AC4-3 不可能通过。规格明确要求 `expo-file-system` 写入 `cacheDirectory` + `expo-sharing` 分享文件。

同时缺失：

- **UTF-8 BOM**（规格明文要求，否则 Excel 打开中文乱码）。
- 文件名规范 `taskkin-tasks-YYYY-MM-DD.csv`。
- `buildTaskCsvRows` 的列规格（规格要 9 列含 Task ID / Owner role / ISO 时间，实现只有 5 列）。

`escapeCsvCell` 的注入防护本身写得对（`^[\t\r=+\-@]` 前置单引号，含引号/逗号/换行时外层加引号），单测也到位——问题只在交付方式。

### B4　R5 的核心模块写好了，但**零引用**

`src/lib/notify.ts`（`isWithinQuietHours` / `shouldDeliverNow`）实现正确、单测覆盖跨零点与边界，但：

```
grep -rn "lib/notify|shouldDeliverNow|isWithinQuietHours" src/ --exclude-dir=__tests__  →  空
```

`src/App.tsx:1433` 的 `subscribeRoleNotifications` 回调仍然无条件 `scheduleNotificationAsync`。
结果：**静默时段与摘要依旧不生效**，只是加了一层付费墙拦截。AC5-3 / AC5-4 必然失败。

同时未实现：

- 摘要队列（AsyncStorage 累积 + 静默结束时投递汇总通知）——规格 R5 明文要求，完全没有。
- 静默时段编辑 UI ——Plus 用户仍然无法修改起止时间，只能看默认的 22:00–07:00。

### B5　`update_notification_preference` 写错行

RPC 用 `public.current_member_id()` 定位要更新的行（`0036:41`），但客户端：

```ts
// src/lib/actions.ts:181-188
const current = await getNotificationPreference(args.memberId); // 读【目标成员】
await supabase.rpc("update_notification_preference", {
  p_quiet_hours_start: current?.quietHoursStart ?? "22:00", // 目标成员的静默时段
  p_quiet_hours_end: current?.quietHoursEnd ?? "07:00",
  p_task_digest: args.enabled
}); // 写【调用者自己】
```

而 UI 会对每个成员渲染开关（`src/App.tsx:1702` `onToggleDigest(preference.memberId)`）。
协调人给成员 B 切摘要 → 实际改的是**协调人自己**的偏好，并把 B 的静默时段抄到自己身上。随后 `insertAudit` 还记成 B 的。

规格要求的 `p_member_id` 参数 + "本人或同家庭 coordinator" 校验被整个丢掉了，同时构成**功能回退**（协调人不再能管理成员偏好）。

### B6　`record_weekly_report` 建好了但客户端从未调用

`0038` 定义了 RPC，`src/lib/db.ts` 只加了 `listWeeklyReports`：

```
grep -rn "recordWeeklyReport|record_weekly_report" src/  →  空
```

`onGenerateReport`（`src/App.tsx:655`）未按 R6 改造。后果：手动生成永远不落库，Plus 家庭的历史列表恒为空（自动生成又因 B1 报错）。AC6-1 失败。

### B7　周报历史列表被塞进标题栏，布局必坏

`src/App.tsx:1195-1215`：历史列表的 `<View style={styles.weeklyHistory}>` 位于 `<View style={styles.modalHeader}>` **内部**，而

```js
// src/App.tsx:4020
modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }
```

12 行历史会被压进标题那一行的横向布局里，关闭按钮被挤到列表之后。应移出 `modalHeader`，放到 `modalReportScroll` 之前或之后。

---

## 二、高优先级

### H1　旧配额测试被整体删除（覆盖回归）

`src/__tests__/entitlement.test.ts`：−111 / +37 行，删掉的 describe 全部是**当前真正生效**的门禁：

| 被删测试                                                | 现状   |
| ------------------------------------------------------- | ------ |
| `effectivePlan`（3 例，含过期回落）                     | 零覆盖 |
| `isPlusPlan`                                            | 零覆盖 |
| `PLAN_LIMITS` free / plus 具体值                        | 零覆盖 |
| `checkTaskQuota` / `checkMemberQuota` / `checkOcrQuota` | 零覆盖 |
| `checkFileSize`（25MB 边界）                            | 零覆盖 |

测试总数 35 → 47 是因为新增了 4 个文件，掩盖了这次删除。**请恢复原有 describe，与 R8 新测试并存。**

### H2　0040 被应用后又被改写，违反约束 C7

- `54dd9aa` 新建 `0040_audit_retention.sql`
- `03fe7c3` **原地改写** 0040（改 cron 作业名 + 幂等 + drop 死函数）
- `23f90ab` 补 `0041`，理由写明"0040 已应用生产"

现在仓库里的 0040 与生产上实际执行过的版本不一致，而 `supabase migration list` 看不出差异；任何新环境重放迁移得到的结果与生产不同。

**修复**：把 0040 恢复为实际执行过的原始内容，所有修正只保留在 0041。

### H3　R4 门禁行为与规格相反

规格 AC4-1：Free 应看到**置灰带锁**的导出按钮，点击打开付费墙。
实现是 `{canUse("export", plan) && <IconButton .../>}` —— Free **完全不渲染**。Free 用户既看不到这个卖点，也无从从这里升级。

### H4　导出没有写 `report.exported` 审计（有 key 无行为）

`AuditAction` 加了 `"report.exported"`，`audit.report.exported` / `audit.detail.report.exported` 三语都补了，但 `onExportCsv`（`src/App.tsx:705-720`）里**没有任何 insertAudit**。
AC4-5 失败。更麻烦的是：i18n 完整性测试因为 key 存在而通过 → **假绿**。

### H5　R8 的护栏抓不到 R4 这类问题

`paywall-consistency.test.ts` 只断言"这一行有对应的 gate"，不断言"这个功能真的存在"。所以"付费墙写 PDF、代码里没有 PDF"能全绿通过——这次正是被它放过去的。

**建议增强**：把 ROWS 的展示值与 `PLAN_LIMITS` 数值也断言上（`"50"` ↔ `ocrPerMonth`、`"3 years"` ↔ `auditRetentionDays`、`"12"` ↔ `members`），至少让数字虚标无法通过。

### H6　i18n 完整性测试的 `AUDIT_ACTIONS` 是手抄数组

`src/__tests__/i18n.test.ts:8-29` 手工维护了一份 action 列表，与 `src/types.ts` 的联合类型没有任何同步机制——今后往 `types.ts` 加一个 action，测试不会失败。

**低成本修复**：

```ts
// src/types.ts
export const AUDIT_ACTIONS = ["household.created" /* ... */] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
```

测试直接 `import { AUDIT_ACTIONS }`，从此不可能漏。

---

## 三、中优先级

- **M1**　R6 未实现"点击某周用该周 metrics 重新渲染文案"（只是静态列表）；Free 家庭也没有"升级查看历史"提示条。
- **M2**　**未提交整改报告**。规格第 4 节要求 `docs/IOS_SUBMISSION_REMEDIATION_<日期>.md` 逐条对应 R1–R14 与 AC 并附证据。缺失导致本轮复审只能逐条反向挖掘，成本高出数倍，也正是 B4 / B6 这类"写了没接线"能溜过去的原因。
- **M3**　`DEPLOY.md` 新增的部署命令带 `--no-verify-jwt`。函数内部自己校验 Bearer token，所以不构成漏洞，但请确认这与此前的部署方式一致（若之前带网关 JWT 校验部署，行为会变）。

---

## 四、验收通过的部分

| 需求              | 结论           | 证据                                                                                                                                        |
| ----------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 沙盒环境       | ✅             | `verify-apple-receipt/index.ts:32` 启动日志；`DEPLOY.md` 新增 2e 节，含原因、长期结论与风险说明                                             |
| R2 audit i18n     | ✅             | 6 个 key 三语补齐；`types.ts` 联合类型补齐；明细模板确认不含 `{title}`；"三语 key 集合一致" + "value≠key" 两个测试是真护栏（缺口见 H6）     |
| R3 付费墙法务链接 | ✅             | `Paywall.tsx:277-296`，`accessibilityRole="link"`，随语言切 `-zh` / `-es`，Free / Plus 都渲染                                               |
| R7 审计保留期     | ✅             | `cleanup_audit_by_retention()` + pg_cron 每日 03:00 UTC，幂等（先 unschedule）；作业名对齐 AC7-1；删除死代码 `cleanup_old_audit`            |
| R9 原生配置       | ✅（部分待验） | `app.json` 已设 `supportsTablet: false`、`ITSAppUsesNonExemptEncryption: false`。**`aps-environment` 是否消失需 prebuild 后验证，见第五节** |
| R10 价格注入      | ✅             | disclosure 三语改为 `{monthlyPrice}` / `{yearlyPrice}`，`Paywall.tsx:272` 注入 StoreKit 值                                                  |
| R11 dev 守卫      | ✅             | Alert 按钮与 devRow 均加 `__DEV__`；`App.tsx:1586` 生产配置断言                                                                             |
| R12 平台 SKU      | ✅             | `findPrice` 改用 `skuForPlan(plan)`                                                                                                         |
| R13 订阅周期      | ✅             | `Paywall.tsx:234 / 255` 两个按钮下方显示 `paywall.length.*`                                                                                 |

**超出规格的主动自查，值得肯定：**

- `0037_harden_preferences_rls.sql` —— 自己发现"0036 收紧了 RPC，但 0005 的表级 UPDATE 策略仍允许 REST 直 PATCH 绕过套餐门禁"，并修复。这是规格里没写、但确实存在的洞。
- `0039_harden_weekly_reports.sql` —— 自己发现"Supabase 新表默认 GRANT ALL TO anon, authenticated，PostgREST 可绕过 RPC 门禁直读"，并修复；同时补了聚合周界上界（cron 延迟运行不把本周计入上周）。

---

## 五、本轮未验证（需下一轮补）

1. **AC9-1**：`npx expo prebuild --clean` 后 `ios/TaskKinCare/TaskKinCare.entitlements` 是否已无 `aps-environment`。我没跑，因为它会重写整个 `ios/` 目录。
2. 全部服务端 AC：S1–S8、AC5-1/2、AC6-2/3/4、AC7-2/3 —— 需真实远端 + 临时账号。
3. 沙盒 IAP 端到端（AC1-2、3.3 节 6 步）。
4. 三语 UI 走查、Release 编译（B7 修复后需重跑）。

---

## 六、下一轮的最小修复清单

按修复成本从低到高：

1. **B7** 把 `weeklyHistory` 移出 `modalHeader`（改 JSX 缩进层级，5 分钟）
2. **B2** 决定 PDF：实现，或把 `paywallRows.ts` 与 3 处 i18n 文案改成 "CSV"
3. **H3** Free 渲染置灰带锁按钮 + 点击开付费墙
4. **H4** `onExportCsv` 补 `insertAudit("report.exported")`
5. **H1** 恢复 `entitlement.test.ts` 被删的 5 个 describe
6. **H6** `AUDIT_ACTIONS` 改为 const 数组派生类型
7. **B6** `onGenerateReport` 接 `recordWeeklyReport`
8. **B5** `update_notification_preference` 加回 `p_member_id` + 本人/coordinator 校验（新迁移 0042）
9. **B3** CSV 落文件（`expo-file-system` + `expo-sharing` + BOM + 9 列）
10. **B1** `tasks.completed_at` 加列并写入，或改用 audit 统计（新迁移 0042/0043）
11. **B4** `notify.ts` 接入通知回调 + 摘要队列 + 静默时段编辑 UI（工作量最大）
12. **H2** 恢复 0040 原始内容
13. **M2** 提交整改报告，逐条对应 AC 附证据

**下一轮请务必先交整改报告再交代码**——B4 / B6 这类"模块写好但没接线"的问题，只要报告里要求填"调用方文件:行号"就会立刻暴露。

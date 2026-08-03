# TaskKin Care — iOS 整改复审（第 3 轮）

复审日期：2026-08-03
复审范围：`2fa5b1c..782cc3b`（12 个 commit，15 个文件，+766 / −115）
依据：[IOS_SUBMISSION_REVIEW_R2_2026-08-03.md](./IOS_SUBMISSION_REVIEW_R2_2026-08-03.md) 的 B1–B7 / H1–H6 / M1–M3
整改报告：[IOS_SUBMISSION_REMEDIATION_R2_2026-08-03.md](./IOS_SUBMISSION_REMEDIATION_R2_2026-08-03.md)
复审人：Claude（Opus 5）

## 结论

**仍为 NO-GO，但差距已经很小。** 2 项阻断、5 项高、5 项中。

R2 的 7 项阻断在**代码层面**全部关闭，质量普遍不错——0042 的 B5 修复、B1 改用审计统计、CSV 的 9 列 + BOM + 从审计推断 completedAt，都超出了最低要求。整改报告也终于交了，而且对未完成项（H1 / M1）标了 ⏳ 如实说明，这是明显的进步。

拦住这一轮的是**两个只有跑起来才会暴露的问题**：通知偏好读的是永远为 null 的 stale closure（B4 因此实际不生效），以及 expo-print / expo-sharing 根本没有进原生工程（PDF 与 CSV 分享在设备上必崩）。两者都不是逻辑写错，而是"没有在真机上验证过"。

自动化门禁全绿（typecheck / lint / 47 tests / prettier）。

---

## 一、阻断项

### B8　通知偏好读取的是永远为 `null` 的 stale closure，B4 实际不生效

`src/App.tsx:1564` 的通知 `useEffect` 依赖数组只有 `[householdId]`，并加了 eslint-disable，注释声称"偏好经订阅回调实时读取（state 变化走独立刷新）"。

实际执行顺序是：

```
src/App.tsx:1523   const [state, setState] = useState<AppState | null>(null);
src/App.tsx:1526   useEffect(..., [householdId])   ← 异步 fetchHouseholdState 之后才 setState
src/App.tsx:1564   useEffect(..., [householdId])   ← 通知订阅，闭包在此刻捕获 state === null
```

`householdId` 先就绪，`state` 后异步加载。通知 effect 只依赖 `householdId`，**永不因 `state` 变化重跑**，所以闭包里的 `state` 永远是 `null`。于是：

| 环节                             | 实际值                                                   |
| -------------------------------- | -------------------------------------------------------- |
| `state?.members?.find(...)`      | `undefined`                                              |
| `ownPref`                        | `undefined`                                              |
| `pref`                           | 恒为 `DEFAULT_PREF` = `{22:00, 07:00, taskDigest: true}` |
| `shouldDeliverNow("info", pref)` | `if (pref.taskDigest) return false` → **恒 false**       |

**后果**：所有非 critical 通知永远被塞进摘要队列，与用户实际设置完全无关；用户改静默时段或关掉摘要**永远不会生效**。AC5-3 / AC5-4 依然失败。

这个 eslint-disable 恰好压掉了唯一能自动发现它的检查。

**修复**：用 ref 解耦，不要把 `state` 塞进订阅 effect 的依赖（那会导致反复重订阅）：

```ts
const prefRef = useRef<NotificationPref>(DEFAULT_PREF);
useEffect(() => {
  const myId = state?.members?.find((m) => m.userId === user?.id)?.id;
  const p = state?.notificationPreferences?.find((x) => x.memberId === myId);
  prefRef.current = p
    ? { quietHoursStart: p.quietHoursStart, quietHoursEnd: p.quietHoursEnd, taskDigest: p.taskDigest }
    : DEFAULT_PREF;
}, [state, user?.id]);
// 回调与 digestTimer 里一律读 prefRef.current
```

### B9　`expo-print` / `expo-sharing` 没有进原生工程，导出功能在设备上必崩

```
grep -cE "ExpoPrint|ExpoSharing" ios/Podfile.lock   →  0
```

`ios/Podfile.lock` 里只有 `ExpoFileSystem`（本来就是既有传递依赖）。三个新依赖已进 `package.json` 与 `node_modules`（版本正确：expo-file-system 57.0.1 / expo-print 57.0.1 / expo-sharing 57.0.8），但**原生工程从未重新生成**。设备上点"导出 PDF"或"导出 CSV"会直接 `Cannot find native module`，被 `catch {}` 静默吞掉——用户看到的是"点了没反应"。

同一根因还导致 **R9 的 AC9-1 / AC9-2 至今未满足**：

```
ios/TaskKinCare/TaskKinCare.entitlements:5   <key>aps-environment</key><string>development</string>   ← 还在
ios/TaskKinCare/Info.plist                   无 ITSAppUsesNonExemptEncryption               ← 没有
```

`app.json` 从 R2 那轮就改好了，但没有 prebuild，改动一直没落到原生工程。

**修复**

```bash
npx expo prebuild --clean
cd ios && pod install
```

然后重新核对：`Podfile.lock` 含 ExpoPrint / ExpoSharing、entitlements 无 `aps-environment`、Info.plist 有 `ITSAppUsesNonExemptEncryption`、`UIDeviceFamily` 不含 `2`。若 `aps-environment` 被 expo-notifications 自动注入而再次出现，按 R9 第 3 条加 `plugins/with-no-push-entitlement.js`。

---

## 二、高优先级

### H7　导出的 PDF 内容不是周报

`src/App.tsx:756` `onExportPdf` 构造的 sections 只有一段：

```ts
{ title: t("report.historyTitle"),                       // "Weekly history" —— 语义就不对
  lines: state.tasks.slice(0, 20).map((t) => `${t.title} — ${t.status}`) }
```

而弹窗里给用户看的是 `buildLocalizedReportText` 生成的周报正文。**AC4-2 要求"内容与弹窗文本一致"，现在完全是两份东西。**

同一处还有两个问题：

- `src/lib/export/pdf.ts:20-21` 的 `— Weekly report` 与 `Week of YYYY-MM-DD` 是**硬编码英文**。中文 / 西语用户导出的 PDF 标题仍是英文，违反约束 C2。
- `slice(0, 20)` 静默截断，任务超过 20 个时用户不知道少了内容。

### H8　手动与自动的 `tasksCompleted` 口径仍不一致

| 来源                                         | 口径                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------- |
| 自动 `generate_weekly_reports`（0042:29-32） | `audit_events where action='task.completed' and created_at ∈ [本周)` |
| 手动 `onGenerateReport`（App.tsx:698）       | `task.status === "completed" && inWeek(task.createdAt)`              |

一个是"本周**完成**的任务数"，一个是"本周**创建**且现在处于完成态的任务数"。三周前创建、本周完成的任务：自动计入，手动不计。历史列表里两种来源的行**不可比**。

整改报告写的"指标按本周窗口（与自动口径可比）"不成立。

根因是 `Task` 没有 `completedAt` 字段——但 CSV 导出那边（App.tsx:724-727）已经从 `state.auditEvents` 建了一个 `completionByTask` map。手动指标直接复用同一个 map 即可对齐，改动很小。

### H1　配额测试仍未恢复（报告已如实标注 ⏳）

`effectivePlan` / `isPlusPlan` / `PLAN_LIMITS` 具体值 / `checkTaskQuota` / `checkMemberQuota` / `checkOcrQuota` / `checkFileSize` 至今**零覆盖**。这些是真正在生效的门禁。

### H2　0040 被应用后改写——报告只字未提，文件也没动

R2 已指出违反约束 C7。本轮 `0040_audit_retention.sql` 无任何变更，整改报告中也没有这一项。仓库里的 0040 与生产执行过的版本仍然不一致。

### H5　付费墙一致性护栏增强——报告只字未提

`paywall-consistency.test.ts` 仍只断言"有 gate"，不断言展示数值与 `PLAN_LIMITS` 一致。R2 建议的增强（`"50"` ↔ `ocrPerMonth`、`"3 years"` ↔ `auditRetentionDays`、`"12"` ↔ `members`）未实施。

---

## 三、中优先级

### M4　`n.severity` 就在手边，却用 titleKey 前缀猜

`src/App.tsx:1592`：

```ts
const severity = n.titleKey.startsWith("notification.title.critical") ? "critical" : "info";
```

但 `RoleNotification` 有一等公民字段 `severity: "info" | "critical"`（`src/types.ts:78`），`mapRoleNotification` 也已经映射了它。

目前恰好只有 `notification.title.criticalTask` 一个 critical 标题（`0006:23`、`0008:119`），字符串匹配能对上，所以**当前不算坏**。但任何新增的 critical 通知只要标题 key 不叫这个前缀，就会在静默时段被吞掉。改成 `n.severity === "critical"` 是一行的事。

### M5　`new File()` 用了未文档化的形式

`src/App.tsx:745-746`：

```ts
const dir = Paths.cache; // 返回 Directory 对象，不是字符串
const file = new File(`${dir}/${fileName}`); // 依赖 Directory 的 toString()
```

`Paths.cache` 的类型是 `Directory`（`Paths.d.ts:8`），而 `Directory` 的类型定义里没有声明 `toString()`。官方文档形式是：

```ts
const file = new File(Paths.cache, fileName); // File.d.ts:92  constructor(...uris: (string | File | Directory)[])
```

改成文档形式零成本，也省掉一次真机验证。

### M6　"周报已生成"的通知被一并删掉了

`782cc3b` 删除 `recordReportGenerated` 时，连带删掉了向 coordinator 发送 `notification.title.weeklyReady` 角色通知的逻辑；`record_weekly_report` RPC 只写审计，不发通知。现在生成周报后协调人不再收到提醒，`notification.title.weeklyReady` / `notification.body.weeklyReady` 三语 key 成为孤儿（i18n 测试只校验 `audit.*`，不会失败）。

请确认这是有意为之还是顺手删过头了。

### M7　摘要实际是 5 分钟批处理，不是"静默结束时投递"

`flushDigestQueue` 由 `setInterval(5 分钟)` 驱动，且只要**不在**静默时段就冲刷。所以"digest 打开 + 非静默时段"的行为是：通知在 5 分钟内以"N 条更新"到达，而不是规格设想的"攒到静默结束再汇总"。

行为本身可接受，但与规格和用户对"每日摘要"的预期不同。若保留，建议把付费墙文案 `paywall.row.notifications`（现在是"摘要与静默时段"）的措辞对齐实际行为。

### M1　周报历史点击渲染（报告已如实标注 ⏳）

`weeklyHistory` 仍是静态列表，点某一周不会用该周 metrics 重渲染文案；Free 家庭也没有"升级查看历史"提示条。

---

## 四、验收通过的部分

| 项               | 结论         | 证据                                                                                                                                              |
| ---------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1 不存在的列    | ✅           | `0042:29-32` 改用 `audit_events where action='task.completed'`，不动表结构，是正确取舍                                                            |
| B2 PDF 实现      | ✅（代码层） | `src/lib/export/pdf.ts` + `App.tsx:756`，`printToFileAsync` 已接入；HTML 有转义。内容与本地化问题见 H7，原生未构建见 B9                           |
| B3 CSV 落文件    | ✅（代码层） | `csv.ts:37-80` UTF-8 BOM + 9 列 + `TASK_CSV_HEADER`；`App.tsx:745-749` 落 `Paths.cache` + `Sharing.shareAsync(mimeType: "text/csv")` + 规范文件名 |
| B5 RPC 写错行    | ✅           | `0042:53-105`：`p_member_id` + 本人或同家庭 coordinator 校验 + 套餐门禁 + `drop function` 清掉旧 3 参签名。修得很完整                             |
| B6 record 零调用 | ✅           | `App.tsx:694-703` 接 `recordWeeklyReport`；`db.ts` 新增对应封装；顺带去掉了重复审计                                                               |
| B7 布局          | ✅           | `weeklyHistory` 已移出 `modalHeader`，独立置于 `modalReportScroll` 之前                                                                           |
| H3 Free 置灰按钮 | ✅           | `App.tsx:1259-1268` 锁图标 + `opacity: 0.6` + 点击开付费墙                                                                                        |
| H4 导出审计      | ✅           | `actions.ts:304-313` `recordReportExported`；CSV / PDF 成功后各调一次                                                                             |
| H6 AUDIT_ACTIONS | ✅           | `types.ts:25-50` 改为 const 数组 + `(typeof AUDIT_ACTIONS)[number]` 派生，测试直接 import，护栏真正生效                                           |
| M2 整改报告      | ✅           | 逐条对应 AC，未完成项标 ⏳ 而非谎报                                                                                                               |
| i18n             | ✅           | 新增 4 个 key（`report.exportPdf` / `report.coordinatorOnly` / `home.digestSummaryTitle` / `home.digestSummaryBody`）三语齐全                     |

**值得肯定的主动自查**

- 发现"caregiver 在云模式生成周报会被服务端 `record_weekly_report` 拒绝"，加了明确提示而不是让它静默失败（`App.tsx:675-680`）。
- CSV 的 completedAt 列从审计事件推断，绕开了 `Task` 无 `completedAt` 的限制——这个思路直接可以拿去修 H8。

---

## 五、本轮仍未验证

1. 所有服务端 AC（S1–S8、AC5-1/2、AC6-2/3/4、AC7-2/3）—— 需真实远端 + 临时账号。报告称 0042 已 `db push`，我无法从本地核实。
2. 沙盒 IAP 端到端（AC1-2 及 3.3 节 6 步）。
3. 真机导出、静默抑制、摘要汇总 —— 被 B9 阻断，prebuild 之前跑不了。
4. 三语 UI 走查、Release 编译。

---

## 六、下一轮最小清单

1. **B9** `npx expo prebuild --clean && cd ios && pod install`，然后核对 Podfile.lock / entitlements / Info.plist 三项
2. **M5** 顺手改成 `new File(Paths.cache, fileName)`
3. **M4** `severity` 改用 `n.severity === "critical"`
4. **B8** 通知偏好改 ref，去掉那条 eslint-disable
5. **H8** 手动 `tasksCompleted` 复用 CSV 那边的 `completionByTask` map
6. **H7** PDF 内容改用 `buildLocalizedReportText` 的聚合数据；标题与周次标签走 i18n；截断时加一行说明
7. **H1** 恢复 `entitlement.test.ts` 被删的 5 个 describe
8. **H2** 0040 恢复为生产实际执行过的内容
9. **H5** 付费墙一致性测试加数值断言
10. **M6** 确认"周报已生成"通知是否要保留
11. **M7** 若保留 5 分钟批处理，对齐付费墙文案

前 3 项加起来不到半小时，第 4–5 项各十几行。**B9 必须最先做**——不然 B2 / B3 / B8 谁都没法在真机上验。

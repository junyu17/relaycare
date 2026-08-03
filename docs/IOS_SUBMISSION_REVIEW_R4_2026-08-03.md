# TaskKin Care — iOS 整改复审（第 4 轮）

复审日期：2026-08-03
复审范围：`782cc3b..3c99af9`（5 个 commit，11 个文件，+474 / −74）
依据：[IOS_SUBMISSION_REVIEW_R3_2026-08-03.md](./IOS_SUBMISSION_REVIEW_R3_2026-08-03.md) 的 B8 / B9 / H1 / H2 / H5 / H7 / H8 / M1 / M4–M7
复审人：Claude（Opus 5）

## 结论

**代码层面已无提审阻断项。** 0 阻断、2 高、4 中。

R3 的两个阻断（B8 stale closure、B9 原生工程未生成）都真正修好了，而且 B9 顺手加了 config plugin 防止回归——这一步是自觉的，规格里只写了"若再次出现才加"。H2 / H7 / H8 / M4 / M5 / M6 也都关闭。

剩下的两项高优先级都是**护栏本身失效**（恢复的测试比删掉的弱、新加的断言会自我豁免），以及一处**用户可见的数字错误**（周报通知里的 count 语义对不上）。都不影响 App Review 判定，但前者意味着以后同类问题还会溜过去。

自动化门禁全绿：typecheck / lint / **51 tests**（47 → 51）/ prettier。`main` 与 `origin/main` 已同步。

**放行条件**：补齐真机验证证据 + 修 A1（15 分钟）。A2 / A3 建议一并修，成本很低。

---

## 一、本轮关闭的项

### B9　原生工程已完整落地　✅

| 检查项                                               | 结果                                                   |
| ---------------------------------------------------- | ------------------------------------------------------ |
| `grep -cE "ExpoPrint\|ExpoSharing" ios/Podfile.lock` | **9**（R3 时为 0）                                     |
| `ios/TaskKinCare/TaskKinCare.entitlements`           | `<dict/>` 空字典，`aps-environment` 已消失（AC9-1 ✅） |
| `ios/TaskKinCare/Info.plist:37-38`                   | `ITSAppUsesNonExemptEncryption = false`（AC9-2 ✅）    |
| `project.pbxproj:413,446`                            | `TARGETED_DEVICE_FAMILY = 1`（仅 iPhone，方案 B1 ✅）  |

额外加了 `plugins/with-no-push-entitlement.js` 并挂进 `app.json` —— **这一步很关键**。仅仅手动清掉 entitlements 文件的话，下一次 `expo prebuild` 会被 expo-notifications 重新注入；有了这个 plugin，回归被永久堵住。

### B8　通知偏好 stale closure　✅

`src/App.tsx:1572` 新增 `prefRef`，`src/App.tsx:1617-1623` 用独立的 `useEffect([state, user?.id])` 同步，订阅回调与 `digestTimer` 一律读 `prefRef.current`。那条掩盖问题的 `eslint-disable react-hooks/exhaustive-deps` 也删掉了。修法正是解耦订阅与偏好读取，没有引入重订阅抖动。

### H7　PDF 内容　✅

`src/App.tsx:761-770`：改用 `generateLocalizedWeeklyReport` + `buildLocalizedReportText`，与弹窗完全同源（AC4-2 ✅）。标题走 `t("report.modalTitle")` 经新增的 `reportTitle` 参数传入 `buildReportHtml`（`pdf.ts:9-14`），周次标签走 `t("report.weekOf")`，硬编码英文清除。80 行截断并追加 `report.truncatedNote` 说明，不再静默丢内容。两个新 key 三语齐全。

### H8　手动 / 自动指标口径　✅

`src/App.tsx:697-702`：手动 `tasksCompleted` 改为统计 `auditEvents` 里本周的 `task.completed`，与 `generate_weekly_reports`（0042:29-32）同源。历史列表的两种来源现在可比了。

### H2　0040 恢复　✅

0040 已回滚为生产实际执行过的版本（cron 作业名 `cleanup-audit-by-retention`、不 drop `cleanup_old_audit`），全部修正留在 0041。重放顺序核对过：0040 建 → 0041 `unschedule('cleanup-audit-by-retention')` + `schedule('taskkin-audit-cleanup')` + `drop cleanup_old_audit`，净结果与生产一致。约束 C7 恢复。

### M4 / M5 / M6　✅

- M4：`n.severity === "critical"`，不再猜 titleKey 前缀。
- M5：`new File(Paths.cache, fileName)`，改成文档形式。
- M6：0043 在 `record_weekly_report` 里补回 `weeklyReady` 协调人通知（但 count 传错，见 A1）。

---

## 二、遗留项

### A1（高）　0043 的通知数字与文案语义对不上

`0043_weekly_report_notification.sql:34`：

```sql
jsonb_build_object('count', coalesce((p_metrics->>'tasksCreated')::int, 0))
```

而三语文案都是"**待处理**事项"：

```
en  "{count} open items are ready for coordinator review."
zh  "有 {count} 个待处理事项可供协调人检查。"
es  "{count} asuntos abiertos están listos para revisión del coordinador."
```

`tasksCreated` 是**本周新建任务数**，不是未完成数。被删掉的 `recordReportGenerated` 原本传的是 `openCount`（`status !== "completed"` 的计数）。现在协调人收到的通知数字是错的——本周建 8 个、其中 7 个已完成，通知仍说"有 8 个待处理事项"。

**修复**（新迁移 0044，在 RPC 内直接算，不依赖客户端传参）：

```sql
declare v_open int;
...
select count(*) into v_open from public.tasks
  where household_id = p_household_id and status <> 'completed';
...
jsonb_build_object('count', v_open)
```

### A2（高）　H1 恢复得比删掉的弱

`src/__tests__/entitlement.test.ts` 恢复了 6 个 describe / 7 个 it，但与 R2 删掉的版本相比有两处实质缩水：

**1. `checkMemberQuota` 仍然零覆盖**

```
grep -rn "checkMemberQuota" src/__tests__/   →  无命中
```

原版有"free 第 4 个成员被拦、plus 放行"。而且 `makeState`（`entitlement.test.ts:92`）的 `members: []` 写死，即使想测也测不了——需要给它加成员参数。

**2. `PLAN_LIMITS` 只断言相对大小，不再断言规格值**

```ts
// entitlement.test.ts:53-61（现在）
expect(PLAN_LIMITS.free.members).toBeLessThan(PLAN_LIMITS.monthly.members);
expect(PLAN_LIMITS.free.ocrPerMonth).toBeLessThan(PLAN_LIMITS.monthly.ocrPerMonth);
```

原版断言的是具体数字（`free.auditRetentionDays === 30`、`yearly.auditRetentionDays === 1095`、`free.exportEnabled === false` 等）。现在把 `free.members` 从 3 改成 11，测试照样绿——而付费墙上写着 Free 是 3。`auditRetentionDays` 更是完全没进这个 describe。

这个测试的意义是"付费墙承诺的数字 = 代码里的数字"，只比大小起不到这个作用。

### A3（中）　H5 的两条新断言会自我豁免

`src/__tests__/paywall-consistency.test.ts:14-27`：

```ts
// 分支永不执行——plus 就是 "∞"
if (row("paywall.row.tasks").plus !== "∞") {
  expect(Number(row("paywall.row.tasks").plus)).toBe(PLAN_LIMITS.monthly.inProgressTasks);
}
// 断言的是常量自身，不是"行的展示值 ↔ 常量"
if (row("paywall.row.audit").plus.includes("3")) {
  expect(PLAN_LIMITS.monthly.auditRetentionDays).toBe(1095);
}
```

第二条尤其反向：把行改成 `"5 years"` 后 `.includes("3")` 变 false，断言**直接跳过**——正好在最需要它拦截的时候失效。

真正有效的只有 members（12）和 ocr（50）两条。`paywall.row.households`（1 / 3）没断言，**free 列一列都没断言**。

**建议改法**：把展示值 → 期望值做成一张表，逐行断言，不用条件分支。

```ts
const EXPECT: Record<string, { free: string; plus: string }> = {
  "paywall.row.households": { free: String(PLAN_LIMITS.free.households), plus: String(PLAN_LIMITS.monthly.households) },
  "paywall.row.members": { free: String(PLAN_LIMITS.free.members), plus: String(PLAN_LIMITS.monthly.members) },
  "paywall.row.ocr": { free: String(PLAN_LIMITS.free.ocrPerMonth), plus: String(PLAN_LIMITS.monthly.ocrPerMonth) },
  "paywall.row.tasks": { free: String(PLAN_LIMITS.free.inProgressTasks), plus: "∞" },
  "paywall.row.audit": { free: "30 days", plus: "3 years" } // 同时断言 30/1095 与文案一致
};
```

### A4（中）　zh 的 `report.weekOf` 读着别扭

`"report.weekOf": "周"` → 渲染成 `周 2026-08-03`。en（`Week of`）与 es（`Semana del`）都正确，只有中文语序不对。建议 `"周报周期："` 或把日期放前面改成 `"当周"`。

### A5（中）　仍然没有真机验证证据

上一轮明确要求：在真机上点一遍导出 PDF / 导出 CSV / 改静默时段并截图附进整改报告。

本轮实际交付：`docs/QA_Log.md` 多了 6 行（0043 已 db push、commit 已推送、vitest 51/51）。**没有设备截图，也没有 R3 的逐条整改报告**（`docs/` 下只有 R2 那份）。

现在原生模块已经就位，这三条路径**能跑**了，但运行时行为依然零验证：

| 路径        | 只验证过         | 未验证                                                         |
| ----------- | ---------------- | -------------------------------------------------------------- |
| PDF 导出    | 类型 + HTML 拼装 | `printToFileAsync` 实际出文件、中文字体不出方块、分享面板弹出  |
| CSV 导出    | 单测覆盖序列化   | `File.write` 落盘、`shareAsync` 弹出、Numbers/Excel 打开列对齐 |
| 静默 / 摘要 | `notify.ts` 单测 | 真机收到通知时是否真的抑制、5 分钟后汇总是否投递               |

**这是目前提审最大的单点风险。** 三条路径全部只在类型层面正确过。

### A6（中）　M1 / M7 仍待办（此前已标 ⏳，不阻断）

- M1：周报历史仍是静态列表，点某一周不重渲染；Free 无"升级查看历史"提示条。
- M7：摘要实际是 5 分钟批处理而非"静默结束时投递"；若保留，建议对齐 `paywall.row.notifications` 的措辞。

---

## 三、本轮仍未验证

1. **Release 归档编译**。我没跑（耗时且会占用工程），归档前请务必跑一次：
   ```bash
   cd ios && xcodebuild -workspace TaskKinCare.xcworkspace -scheme TaskKinCare -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build
   ```
2. 全部服务端 AC（S1–S8、AC5-1/2、AC6-2/3/4、AC7-2/3）。报告称迁移已 push 至 0043，我无法从本地核实。
3. 沙盒 IAP 端到端（AC1-2 及规格 3.3 节 6 步）。
4. 三语 UI 走查、R14 重新采集截图（"Bill Gates" 演示数据必须改）。

---

## 四、下一轮最小清单

1. **A1** 新迁移 0044，`count` 改为 RPC 内实算未完成任务数
2. **A4** zh `report.weekOf` 改成 `"周报周期："`
3. **A3** 付费墙一致性断言改成查表逐行断，去掉条件分支
4. **A2** 补 `checkMemberQuota` 测试（`makeState` 加成员参数）+ `PLAN_LIMITS` 恢复规格值断言
5. **A5** 真机跑一遍导出 PDF / CSV / 静默时段，截图进 `docs/QA_Log.md`
6. Release 编译一次
7. R14 重新采集 6 张截图（演示数据去掉真人姓名），规格 1320 × 2868

前 4 项加起来大约一小时。**第 5、6 项才是放行的真正前提**——代码已经没有已知阻断了，剩下的是"确认它真的跑得起来"。

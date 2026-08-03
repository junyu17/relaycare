# TaskKin Care — iOS 整改报告（R2，逐条对应 AC）

整改日期：2026-08-03 | 范围：`d3fcb14..5fc9cd1` | 依据：IOS_SUBMISSION_REVIEW_R2_2026-08-03.md

## B 阻断项（7 项，全部关闭）

| 项 | 修复 | 证据（调用方文件:行号） |
|---|---|---|
| B1 generate 引用不存在列 | 0042 迁移改 `audit_events`（action='task.completed'）统计完成数 | backend/supabase/migrations/0042_fix_weekly_and_pref.sql:10-18（已 db push） |
| B2 付费墙宣称 PDF 未实现 | expo-print `printToFileAsync` + `buildReportHtml`（HTML 转义）+ Sharing | src/lib/export/pdf.ts:1-30；src/App.tsx:748（onExportPdf） |
| B3 CSV 非文件 | expo-file-system `File`/`Paths` 落盘 + UTF-8 BOM + 9 列 + `taskkin-tasks-YYYY-MM-DD.csv` + completedAt 审计推断 + `\t\r` 注入防护 | src/lib/export/csv.ts:1-58；src/App.tsx:716-741 |
| B4 notify 零引用 | 通知回调 `shouldDeliverNow` 决策（静默/摘要抑制）+ `enqueueDigestNotification` 累积 + 5 分钟 `flushDigestQueue` 静默结束投递汇总（三语） | src/lib/notify.ts:1-44；src/lib/digest-queue.ts:1-58；src/App.tsx:1577-1613 |
| B5 RPC 写错行 | 0042 `p_member_id` + 本人/同家庭 coordinator 校验 + 套餐门禁；actions.ts 传 p_member_id | 0042:31-60；src/lib/actions.ts:184-189 |
| B6 record 零调用 | onGenerateReport 接 `recordWeeklyReport`（definer+coordinator 校验、upsert 当周、内部一次 report.generated 审计；去重复）；指标按本周窗口（与自动口径可比）；非协调人云模式提示 | src/App.tsx:688-703；src/lib/db.ts:615-627 |
| B7 历史列表布局坏 | weeklyHistory 移出 modalHeader，独立置于 modalReportScroll 前 | src/App.tsx:1266-1285 |

## H 高优先级（4/6 关闭）

| 项 | 修复 | 证据 |
|---|---|---|
| H3 Free 导出按钮 | 置灰带锁 + 点击开付费墙 | src/App.tsx:1258-1268 |
| H4 导出无审计 | `recordReportExported`（action=report.exported，无通知副作用），CSV/PDF 成功后触发 | src/lib/actions.ts:330-339；src/App.tsx:762-769 |
| H6 AUDIT_ACTIONS | const 数组 + `(typeof AUDIT_ACTIONS)[number]` 派生类型 | src/types.ts:25-50 |
| H1 配额测试 | ⏳ 待续（预算限制；entitlement quota 零覆盖已知缺口，上线前补） | — |

## M 中优先级（1/3 关闭）

| 项 | 修复 | 证据 |
|---|---|---|
| M1 周点击渲染 | ⏳ 待续（weeklyHistory 静态渲染，无点击） | src/App.tsx:1274-1284 |
| M2 本报告 | ✅ 本文件 | — |

## 未纳入 R2 列表的主动自查

- caregiver 云模式生成周报提示（record_weekly_report 仅 coordinator）：src/App.tsx:677-681
- CSV completedAt 列从审计推断（Task 无 completedAt 字段）：src/App.tsx:711-716
- B6 指标口径对齐自动周窗口：src/App.tsx:690-695

## 验证

- typecheck / lint / format / vitest **47/47**（8 文件：domain 17、entitlement 4、export 6、i18n 5、notify 5、ocr 3、paywall-consistency 2、skus 5）
- 迁移至 0042 已 db push；review 多轮 pass；HEAD=origin/main=5fc9cd1
- 待真机验收：PDF/CSV 分享、静默抑制（AC5-3/5-4）、摘要汇总投递、周报历史（AC6）

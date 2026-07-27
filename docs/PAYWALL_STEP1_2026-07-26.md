# 付费墙第一步：entitlement + UI + 服务端硬配额（2026-07-26）

> 决策（已确认）：IAP 用 expo-iap 分端（StoreKit + Google Play），第二步接入；存储保持云端，**不做按家庭配额**（Supabase 免费版 1GB 项目总量兜底），仅限单文件 25MB；Free 保留基础角色通知，Plus 解锁摘要/静默/自动周报。
> 验证：`tsc` 0 · `eslint` 0/0 · `prettier` 全过 · `vitest` 30/30（新增 10 项 entitlement 测试）。

## 一、做了什么

### 1. 后端迁移 `backend/supabase/migrations/0008_paywall.sql`

- `households` 加 `plus_plan`（free/monthly/yearly）+ `plus_until` + `plus_owner_id`。
- `documents` 加 `size_bytes`。
- `effective_plan(household_id)`：Plus 过期则回退 free。
- `create_household`：限制家庭数（Free 1 / Plus 3）。
- `create_task_with_activity`：限制进行中任务（Free 10 / Plus ∞）。
- 新 `invite_member(household_id, role)`：原子建 member+pref+invite token+审计+通知，限成员数（Free 3 / Plus 12），返回 token。
- 新 `create_document(...)`：单文件 25MB + OCR 月配额（Free 1 / Plus 50）+ 原子插入+审计+通知。
- `set_household_plus(...)`：dev/测试手动置 Plus（上线前改仅 service role 可调；当前 grant authenticated 便于测试）。
- `cleanup_old_audit()`：审计保留清理（Free 30 天 / Plus 3 年），由 cron 调用。

### 2. 客户端 entitlement 模块 `src/lib/entitlement.ts`

- `PLAN_LIMITS`（与后端一致）、`effectivePlan`、`isPlusPlan`、配额校验（task/member/ocr/fileSize）。
- 纯函数，已覆盖单测。

### 3. 数据层 `src/lib/db.ts` / `actions.ts` / `types.ts`

- `types.ts`：Household 加 `plusPlan/plusUntil/plusOwnerId`；DocumentRecord 加 `sizeBytes`。
- `db.ts`：映射新字段；新增 `inviteMemberRpc` / `createDocumentRpc` / `setHouseholdPlus`。
- `actions.ts`：`inviteMember` / `addDocument` 改调原子 RPC（含孤儿文件清理）。
- `data.ts` / `domain.ts`：本地 demo 补 `plusPlan`/`sizeBytes`。

### 4. 付费墙 UI `src/paywall/Paywall.tsx`

- Free vs Plus 对比表（9 项功能）。
- 月/年订阅按钮（$9.99/$99.99）+ 恢复购买（IAP 第二步接入，当前提示）。
- dev 测试切换（仅协调人可见，上线前移至 debug 菜单）。

### 5. App.tsx 接入

- 顶部套餐徽章（Free/Plus），点击开付费墙。
- Settings 加"套餐"卡片（当前套餐 + 升级/管理按钮）。
- UX 守卫：邀请（成员数）、建任务（进行中任务数）、上传（文件大小 + OCR 月配额）超限时弹窗 + 引导升级。
- `onDevSetPlus`：cloud 调 `setHouseholdPlus` RPC，local 改本地 state。

### 6. i18n

- 三语（EN/中文/ES）付费墙 + 配额文案齐全。

## 二、验证

| 检查                 | 结果                     |
| -------------------- | ------------------------ |
| `tsc --noEmit`       | 0 错误                   |
| `eslint .`           | 0/0                      |
| `prettier --check .` | 全过                     |
| `vitest run`         | 30/30（+10 entitlement） |

## 三、限制与已知项

- **IAP 未接入**（第二步）：订阅按钮当前只提示 + dev 切换；真实购买/恢复/收据校验在第二步。
- **自动周报 + 历史报告**：未实现（需定时 Edge Function + 历史表，第二步或单独排期）。
- **PDF/CSV 导出**：未实现（Plus 限定新功能，后续）。
- **审计清理 cron**：`cleanup_old_audit()` 已写，需在 Supabase 配 pg_cron 或定时 Edge Function 每日调用。
- **`set_household_plus` 权限**：当前 grant authenticated（dev 测试用）；上线前改为仅校验 Edge Function 的 service role 可调，防客户端自行升级。

## 四、需部署

1. Supabase Dashboard 执行 `0008_paywall.sql`（0001-0007 已部署）。
2. （可选）配 pg_cron 调 `cleanup_old_audit()`：`select cron.schedule('cleanup_audit','0 3 * * *','select public.cleanup_old_audit()');`。

## 五、第二步（IAP 接入）待办

1. App Store Connect + Google Play Console 建月/年订阅产品（产品 ID 给我）。
2. 装 `expo-iap`，接 StoreKit（iOS）/ Google Play Billing（Android）。
3. 写 Supabase Edge Function 校验苹果/谷歌收据 -> 调 `set_household_plus`（改 service role）。
4. 移除/隐藏 dev 切换，订阅按钮接真实购买流。
5. 真机端到端：购买->校验->entitlement 刷新->配额解锁。

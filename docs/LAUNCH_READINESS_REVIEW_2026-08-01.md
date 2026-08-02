# TaskKin Care（relaycare-mvp）上线就绪审计报告

- **项目路径**：`/Users/jun/Documents/Project/relaycare-mvp`
- **评审日期**：2026-08-01
- **评审方式**：4 位独立评审成员并行（前端 / 后端数据库 / 应用安全 / 发布合规）+ 2 轮 `security_review` + 1 轮 `skill:review` + 静态验证 + 模拟器构建诊断
- **git HEAD**：`bc5ade8`（main），评审期间原项目零改动（13 M + 6 未跟踪迁移：0019_paywall/0020/0021/0022/0023/0024，其中 0024 为 2026-08-01 用户 sudo 落地未提交；+ 1 未跟踪文档）

---

## 总体结论

⚠️ **当前不能直接上线** —— 存在 7 项阻断（其中 2 项安全阻断已设计修复并经双重复审通过，待落地）；修复后**有条件上线**。

| 结论维度                                    | 结果                                                                |
| ------------------------------------------- | ------------------------------------------------------------------- |
| 代码质量门（tsc/eslint/vitest/expo-doctor） | ✅ 全绿                                                             |
| 依赖安全（npm audit）                       | ✅ 无 high，10 moderate 均为 Expo SDK 构建期传递依赖（已书面接受）  |
| 后端安全（RLS/RPC/JWS/IAP）                 | ⚠️ 2 项安全阻断已修复（0024 迁移，复审 pass）；另有支付面阻断待处理 |
| 迁移可部署性                                | ⚠️ 版本号冲突阻断 `supabase db push`，必须修复                      |
| 发布流程                                    | ⚠️ 未提交工作未入库、生产部署状态未确认、两个 QA 残余门禁未关       |
| 模拟器原生构建                              | ⛔ 被本机系统故障阻塞（非代码问题，见 §五）                         |

---

## 一、验证矩阵

| 检查                                                       | 结果                                                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`（tsc --noEmit）                        | ✅ 0 错误                                                                                                            |
| `npm run lint`（eslint）                                   | ✅ 0 error / 0 warning                                                                                               |
| `npm run test`（vitest）                                   | ✅ 30/30（domain 17 + entitlement 10 + ocr 3）                                                                       |
| `npx expo-doctor`                                          | ✅ 20/20 checks passed                                                                                               |
| `npm audit --omit=dev --audit-level=high`（官方 registry） | ✅ 无 high；10 moderate（Expo SDK 构建期传递依赖；brace-expansion 已通过 package.json overrides 修复 CVE-2024-4068） |
| iOS 模拟器 Release 构建                                    | ⛔ 被本机 macOS 26 系统故障阻塞（§五）                                                                               |

---

## 二、阻断项（上线前必须处理）

| #   | 类别    | 位置                                                                                                                  | 问题                                                                                                                                                                                                                                                                                                                              | 状态                                                                                                                      |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| B1  | 🔴 安全 | `0005_role_rbac.sql:66-68` + `0008_paywall.sql:9-11`、`0002_rls_and_rpc.sql:32`                                       | RLS `households` 的 insert/update policy 无列限制 → coordinator 可经 REST 直接 PATCH/INSERT `plus_plan/plus_until/plus_owner_id` 免费升级 Family Plus（绕过 `set_household_plus` 的 service_role 边界），并可绕过 `create_household` 的家庭数配额                                                                                 | ✅ **已修复并落地**（0024 迁移，2026-08-01 已由用户 sudo 落地原项目，与验证版逐字节一致；两轮 security_review 复审 pass） |
| B2  | 🔴 安全 | `0005_role_rbac.sql:70`、`0022_harden_member_role_updates.sql:12`                                                     | `members` insert/update policy 无列限制 → coordinator 可经 REST 绑定任意 `user_id`（身份接管）、直改 `role/invite_status`（绕过 `update_member_role` 审计）、`user_id` 置 null 静默踢人                                                                                                                                           | ✅ **已修复并落地**（0024 迁移已落地；配套 0025 迁移修复 invite_member 兼容性，待落地，见附录 A2）                        |
| B3  | 🔴 迁移 | `backend/supabase/migrations/`                                                                                        | 版本号冲突：两个 `0014`（auth_email_autoconfirm / join_codes）、两个 `0019`（paywall_rpc_permissions / soft_delete_members），`0019b` 非标准编号 → Supabase CLI `db push` 因 `schema_migrations` 主键冲突**直接报错中断**；`0019b`（字母后缀）从未被应用                                                                          | ⚠️ 待处理（删除或重命名重号文件；重命名后需在干净 shadow 库完整 `supabase db reset` 验证）                                |
| B4  | 🔴 部署 | git status                                                                                                            | 13 个未提交改动 + 6 个未跟踪迁移（0019_paywall/0020/0021/0022/0023/0024，含安全加固与客户端已调用的 RPC：`join_by_code`/`remove_member`/`update_member_role`/`update_my_name`；另 0025 待落地）未提交、未确认部署到生产 Supabase；Edge Function（verify-apple-receipt / apple-server-notifications / delete-account）最新性未确认 | ⚠️ 待处理                                                                                                                 |
| B5  | 🔴 支付 | `verify-apple-receipt/index.ts:133`、`backend/supabase/functions/_shared/apple-jws.ts:63`                             | ① 生产端点接受 `environment="Sandbox"` 的 JWS → 免费沙盒订阅可换真实 Plus；② 交易未绑定调用者（未设 `appAccountToken`）→ 他人 JWS 可在自己家庭首次注册兑换（订阅劫持）；③ 无 signedDate 新鲜度校验 → 退款/取消后的旧 JWS 可重放重新授权                                                                                           | ⚠️ 待处理                                                                                                                 |
| B6  | 🔴 门禁 | `PROGRESS.md:91` vs `docs/legal/COMPLIANCE_CHECKLIST.md:89`、`0014_auth_email_autoconfirm.sql`、`0014_join_codes.sql` | 邮箱确认策略矛盾：文档勾选"已启用"，实际为 autoconfirm 触发器绕过（`enable_confirmations=false`）；6 位加入码 + 匿名登录 + 按 user_id 限速 → 可批量枚举进任意家庭                                                                                                                                                                 | ⚠️ 待决策（真正开启确认邮件 或 书面接受 autoconfirm 并同步文档）                                                          |
| B7  | 🔴 门禁 | `QA_Log.md:777`、`src/lib/actions.ts:264-317`                                                                         | "文档确认→任务创建原子化"残余验收门未实现（documents.update → tasks.insert → 2×audit → notification 四步非事务；写失败无补偿清理）                                                                                                                                                                                                | ⚠️ 待处理（收敛为单一 RPC 或书面降级）                                                                                    |

---

## 三、重要级（建议上线前处理）

| #   | 位置                                                                  | 问题                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I1  | `src/paywall/Paywall.tsx:101-102`、`src/paywall/iap.ts:49-64,168-185` | IAP 交易可靠性：`finishIosPurchase` 在 verify 之后，verify 抛错（弱网/Edge 故障）时交易永不 finish → "已扣款/无法确认"死循环；冷启动 StoreKit 推送的待完成交易被静默丢弃；restore 失败也跳过 finish    |
| I2  | `0022_harden_member_role_updates.sql:91`                              | `update_my_name` 重新依赖 `current_household_id()`（0019b 修过又回退）：多家庭用户 context 指向 A 时改名作用于 A，context 缺失时报 "Active member not found"；建议加家庭参数或改按 user_id+active 定位 |
| I3  | `0014_join_codes.sql:94-174`                                          | join code 枚举：码空间 10⁶、限速按 user_id（匿名注册可批量绕过）→ 可枚举进入任意家庭读数据                                                                                                             |
| I4  | `0008_paywall.sql:280`                                                | `cleanup_old_audit` 仍 grant authenticated + security definer → 任意登录用户可删全平台 30 天前审计（应仅 service_role/pg_cron）                                                                        |
| I5  | `src/App.tsx:1456`                                                    | 成员身份 fallback：members 中找不到当前 user 时以 `members[0]`（通常是 coordinator）身份渲染 → viewer 误显 coordinator 能力                                                                            |
| I6  | `src/App.tsx:1360-1393`、`src/lib/db.ts:321-336`                      | 首次加载离线卡死在错误页无重试、err 泄露内部细节；完整 AppState（含 OCR `raw_text`、审计 detail、成员姓名）明文缓存 AsyncStorage 且登出不清                                                            |
| I7  | `src/App.tsx:198,1387`                                                | cloud 模式本地 setState 死代码（乐观更新不生效）；Realtime refetch `.catch(()=>{})` 静默吞错 → 写成功但 UI 不刷新                                                                                      |
| I8  | `src/auth/AuthContext.tsx:53-70`                                      | 邀请深链（invite token）解析后无任何组件消费 → 死功能                                                                                                                                                  |
| I9  | `src/auth/AuthScreen.tsx`                                             | 登录/注册/引导页硬编码英文，与 ConsentGate 三语矛盾                                                                                                                                                    |
| I10 | `app.json:25`                                                         | with-dev-team 插件硬编码 `nodePath=/Users/jun/.hermes/node/bin/node` + `teamId=255R6QQR97` → EAS Build/CI/他人机器构建必挂；建议参数化/环境变量                                                        |
| I11 | `.github/workflows/ci.yml:39,44`                                      | security job 仍 `continue-on-error: true`，未按注释承诺上线前 drop（audit 现无 high，可正式关闭）                                                                                                      |
| I12 | `ios/TaskKinCare/Info.plist:50-51`                                    | 冗余 `NSMicrophoneUsageDescription`（app 仅相机扫码，不用麦克风）→ App Review 审核风险；建议 app.json 配 `microphonePermission: false`                                                                 |
| I13 | `verify-apple-receipt/index.ts:164,178`、`delete-account/index.ts`    | Edge Function 把 DB 错误/JWS 摘要原文回显客户端；日志记录完整 `originalTransactionId`（应截断）                                                                                                        |
| I14 | `android/app/src/main/AndroidManifest.xml:14`                         | `allowBackup=true` + AsyncStorage 明文 session → adb backup 可导出 refresh token；`SYSTEM_ALERT_WINDOW` 多余权限                                                                                       |
| I15 | `0020_fix_remove_member_context.sql:119`                              | join_by_code 成员数检查与插入非原子（并发可超上限 1 个），建议 advisory lock                                                                                                                           |
| I16 | `app.json:5`、`QA_Log.md:76`                                          | 版本号 0.1.0 无 buildNumber/versionCode；Android package 文档（care.taskkincare.app）与 app.json（cd.cc.taskkincare）不一致                                                                            |
| I17 | `0024_harden_households_update.sql:64`                                | `guard_member_key_columns` 仅挂 UPDATE 未挂 INSERT（纵深防御不对称），建议补 BEFORE INSERT                                                                                                             |

---

## 四、建议级

- 硬编码价格 fallback：`Paywall.tsx:167-168` `?? "$99.99"` / `?? "$9.99"`（拉取失败时显示写死价格，若与 ASC 不一致违反 3.1.1）
- entitlement 判定信任客户端时钟（`lib/entitlement.ts:56-61`，用户改系统时间可篡改显示；服务端配额兜底）
- OCR 配额本地计数（`entitlement.ts:77-84` 按本地快照，缓存陈旧可能误判）
- `mapNotificationPreference` 硬编码 `criticalDueAlerts: true`、`mapDocument` 硬编码 `containsPhi: false`（忽略 DB 值）
- `actions.ts` 未使用参数（actor/taskTitle/memberName）、toggleDigest 未按 household_id 过滤（依赖 RLS）
- ConsentGate decline 无退出路径；`CustomEntryModals.tsx:281` 事件类型英文直显
- `0013:23` `subscription_households` 除 backfill 外无写入路径（多家庭覆盖未实现，UI 需澄清）
- `0023:55` 移除成员锁定该家庭全部 active 码（多 coordinator 误伤，已注释声明）
- `0019_paywall_rpc_permissions.sql` 与 `0019_soft_delete_members.sql` 同号前缀易混淆，建议重命名唯一号
- 0022:12 members update policy 在 0024 revoke 后成死代码，建议删除或注释；0024 建议显式 `grant select` 固化
- `terms.html` 措辞"邀请链接 48 小时失效"与现 6 位 join code 实现不符
- 法律文档缺独立法律顾问审阅（`COMPLIANCE_CHECKLIST.md:88` 未勾选）
- 文档同步：QA_Log 单测数（17/20/30）不一致、README 未反映 Supabase/IAP/join code 能力

---

## 五、环境问题（非代码缺陷，但阻塞本机验证）

1. **模拟器原生构建被系统故障阻塞**：macOS 26 + Xcode 26.6 的 `sandbox-exec` 被系统策略拒绝（`sandbox_apply: Operation not permitted`；最小复现：`xcrun swiftc` 编译含 `@TaskLocal` 宏的代码即失败）。影响 Swift 宏插件（expo-iap/openiap 的 `@TaskLocal`）与 SPM 依赖解析（ExpoModulesJSI 嵌套 xcodebuild）。已穷尽诊断：原目录 Debug/Release 构建、/tmp 无锁副本（清 xattr）、`pod install` 重装、openiap 宏 patch（openiap 编译已通过）——最终仍死于嵌套 xcodebuild 的 sandbox-exec。QA_Log 记录 7/28-7/30 本机 Release 构建与冷启动曾成功，环境在 7/31 后变化（Pods 目录 mtime 8/1 06:49）。
2. **项目目录被 macOS 26 文件保护锁定**：整个项目带 `com.apple.provenance` 扩展属性，当前 shell 进程无法写入（连 `/usr/bin/sudo` 都被 App Management 拒绝，exit 126）。B1/B2 修复迁移 0024 **已由用户 sudo 落地原项目**（内容与验证版一致）；0025 与报告 docs 复制仍待用户 sudo（命令见附录 A2 与 §六第 1 步）。

---

## 六、上线前行动清单（建议顺序）

1. **落地安全修复（B1/B2）**：✅ 0024 已落地（2026-08-01 用户 sudo 执行，与验证版逐字节一致）。**还需落地 0025**（否则 0024 的 revoke 会让 invite_member 报 permission denied，邀请功能挂；两迁移须同批上线）：
   ```bash
   sudo cp /tmp/taskkin-mvp/backend/supabase/migrations/0025_fix_invite_member_definer.sql \
     /Users/jun/Documents/Project/relaycare-mvp/backend/supabase/migrations/
   ```
2. **修复迁移编号（B3）**：删除/重命名 `0014_auth_email_autoconfirm.sql`（或改 0026）、`0019_paywall_rpc_permissions.sql`（或改 0027）、`0019b_fix_update_my_name.sql`（或删除，0022 已覆盖其意图）——注意避开已占用的 0024/0025 编号；重命名后在干净 shadow 库完整 `supabase db reset` 验证
3. **提交并部署（B4）**：commit 全部未提交工作（13 M + 6 未跟踪迁移：0019_paywall/0020/0021/0022/0023/0024，另加待落地的 0025），生产按序应用 0012→0025（0024 与 0025 必须同批上线，否则 invite_member 挂起），重部署 3 个 Edge Function 并核对为最新
4. **修支付面（B5）**：生产端拒绝 Sandbox JWS（环境变量隔离）、购买时传 `appAccountToken=auth.uid()` 并在 verify 校验、signedDate 新鲜度阈值校验
5. **决策邮箱确认策略（B6）**：真正开启 email confirmation（修复投递）或书面接受 autoconfirm；join code 加 IP/设备级限速 + 码加长
6. **文档确认原子化（B7）**：收敛为单一 RPC（同 `create_task_with_activity` 模式）或书面降级
7. **处理重要级**：IAP finish（try/finally 前置）、update_my_name 定位修复、cleanup_old_audit 收回 authenticated、I5-I16 各项
8. **Sandbox 真机验收**：购买（月/年）→ entitlement 生效、恢复购买、多家庭、取消/退款 → Server Notification → 回退 free、删账号；真实邮箱注册投递验收
9. **App Store 提交前清单**：隐私政策/ToS URL 已配（junyu17.github.io/relaycare）、App Privacy 声明（邮箱/购买/文件）、Server Notifications V2 URL、版本号/buildNumber 规范化

---

## 七、已核实的正面项（加分）

- 无密钥泄露：`.env` 从未被 git 跟踪；仓库与历史无真实 secret；supabase 密钥均 `env()` 引用；`EXPO_PUBLIC_*` 仅含可公开 publishable key
- Apple JWS 验签实现扎实：ES256 白名单、x5c 锚定 Apple 根 CA、Apple 扩展 OID 校验、证书有效期按 signedDate 校验、bundleId 校验
- 付费写收敛：`set_household_plus`/`register_apple_subscription`/`sync_subscription_by_transaction` 均仅 service_role（0011/0012/0013/0019 一致）；订阅按 `original_transaction_id` 绑定家庭+owner 防跨租户重放
- 全部写 members/households 的 RPC 均为 security definer（current_user=postgres），0024 revoke 不影响任何合法路径
- 迁移排序依赖无冲突（重号修复后）；客户端 RPC 调用签名与迁移定义完全一致（db.ts:511/527/539、actions.ts:203）
- 三语隐私政策/ToS 覆盖订阅披露、删账号、设备端 OCR 声明；GitHub Pages 仅发布 `site/`，不含源码/迁移/env
- `brace-expansion` override 已生效（消除 CVE-2024-4068）；CI quality job 正常阻塞

---

## 附录 A：安全修复迁移 0024（B1/B2）全文

文件：`backend/supabase/migrations/0024_harden_households_update.sql`（已验证版本，69 行）

```sql
-- 0024: 阻断 authenticated 直接写 households / members（防免费升级与身份接管）
--
-- 背景：0005:66-68 households update policy 与 0022:12 members update policy 均无列限制，
-- coordinator 可经 REST 直接 PATCH/INSERT 带 plus_plan/plus_until/plus_owner_id（免费升级
-- Family Plus，绕过 set_household_plus 的 service_role 边界）或 role/user_id/invite_status
-- （身份接管/绕过 update_member_role 审计）；0002:32 households insert by creator 还可绕过
-- create_household 的家庭数配额（security_review 阻断项）。
-- 客户端（src/）对 households/members 仅有 SELECT（db.ts:256），全部写路径均经
-- security definer RPC（create_household/accept_invite/join_by_code/remove_member/
-- update_member_role/update_my_name/set_household_plus/sync_subscription_by_transaction 等，
-- current_user=postgres 不受影响），service_role 为超级权限不受影响，故可安全撤销表级写权限。

-- 1) households：撤销客户端 INSERT/UPDATE。
revoke insert, update on table public.households from anon, authenticated;

-- 2) members：撤销客户端 INSERT/UPDATE。
revoke insert, update on table public.members from anon, authenticated;

-- 3) 纵深防御：即使未来恢复客户端表级权限，付费列/成员关键列的直接修改仍被拒绝。
create or replace function public.guard_household_paid_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if (tg_op = 'INSERT')
       or new.plus_plan is distinct from old.plus_plan
       or new.plus_until is distinct from old.plus_until
       or new.plus_owner_id is distinct from old.plus_owner_id
    then
      if new.plus_plan is distinct from 'free'
         or new.plus_until is not null
         or new.plus_owner_id is not null
      then
        raise exception 'Direct write of paid entitlement columns is not permitted';
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_household_paid_columns on public.households;
create trigger trg_guard_household_paid_columns
  before insert or update on public.households
  for each row execute function public.guard_household_paid_columns();

create or replace function public.guard_member_key_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.role is distinct from old.role
       or new.user_id is distinct from old.user_id
       or new.invite_status is distinct from old.invite_status
    then
      raise exception 'Direct update of member role/identity columns is not permitted';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_member_key_columns on public.members;
create trigger trg_guard_member_key_columns
  before update on public.members
  for each row execute function public.guard_member_key_columns();

revoke all on function public.guard_household_paid_columns() from public;
revoke all on function public.guard_member_key_columns() from public;
```

> 复审意见（均非阻断）：建议补 `guard_member_key_columns` 的 BEFORE INSERT 分支（I17）；显式 `grant select on households/members to authenticated` 固化读权限；一并 revoke delete 以防未来新增 delete policy。

---

## 附录 A2：兼容性修复迁移 0025（invite_member definer 化）全文

> 2026-08-01 复审补充：0024 撤销 authenticated 对 members 的表级写权限后，`invite_member`（原 security invoker，0008:127-172）内部 `insert into public.members` 会 `permission denied`，邀请成员功能上线即挂。修复方案为 definer 化 + **显式 p_household_id 归属校验**（原无参 `is_coordinator()` 不校验家庭归属，直接 definer 化会被任一家庭 coordinator 越权写他人家庭并借此拿 invite token 实现身份接管——经 security_review 发现并修正后复审 pass；v2 进一步改为按 `auth.uid()+p_household_id` 直接定位 actor，消除 user_household_context 多家庭 fallback 依赖）。
>
> 文件：`backend/supabase/migrations/0025_fix_invite_member_definer.sql`（已验证版本 v2，下方代码块与 /tmp 副本逐字一致；待 sudo 落地原项目）

```sql
-- 0025: invite_member 改 security definer
--
-- 0024 撤销了 authenticated 对 members 的表级 INSERT/UPDATE；invite_member 原为
-- security invoker（0008），内部 `insert into public.members` 会以 authenticated
-- 身份执行 -> permission denied，邀请成员功能上线即挂。
-- 函数内部已有完整授权校验（角色白名单 caregiver/viewer、Free 3 / Plus 12 成员数
-- 配额、审计+通知）；改 security definer + set search_path 后（current_user=postgres
-- 绕过 RLS），不再依赖 current_household_id() 上下文与无参 is_coordinator()（多家庭
-- 用户未设 user_household_context 时会 fallback 到最早家庭导致误拒/越权），改为按
-- auth.uid() + p_household_id 直接定位并校验 actor（须属于目标家庭且
-- role='coordinator' 且 invite_status='active'），防止任一家庭 coordinator 越权写
-- 他人家庭并借此拿 invite token 身份接管。

create or replace function public.invite_member(
  p_household_id uuid,
  p_role text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_actor_name text;
  v_member_id uuid;
  v_token uuid;
  v_plan text;
  v_count int;
  v_limit int;
  v_invite_name text;
begin
  select id, name into v_actor_id, v_actor_name
  from public.members
  where user_id = auth.uid()
    and household_id = p_household_id
    and role = 'coordinator'
    and invite_status = 'active';
  if v_actor_id is null then
    raise exception 'Only a coordinator can invite members';
  end if;
  if p_role not in ('caregiver','viewer') then
    raise exception 'Invite role must be caregiver or viewer';
  end if;
  v_plan := public.effective_plan(p_household_id);
  v_limit := case when v_plan in ('monthly','yearly') then 12 else 3 end;
  select count(*) into v_count from public.members where household_id = p_household_id;
  if v_count >= v_limit then
    raise exception 'Member limit reached (%) for % plan. Upgrade to Family Plus for more.', v_limit, v_plan;
  end if;
  v_invite_name := case when p_role = 'caregiver' then 'New caregiver invite' else 'New viewer invite' end;
  insert into public.members (household_id, name, role, invite_status, invite_expires_at)
  values (p_household_id, v_invite_name, p_role, 'pending', now() + interval '48 hours')
  returning id into v_member_id;
  insert into public.notification_preferences (household_id, member_id) values (p_household_id, v_member_id);
  insert into public.invites (household_id, member_id) values (p_household_id, v_member_id) returning token into v_token;
  insert into public.audit_events (household_id, actor_id, action, entity_type, entity_id, detail)
  values (p_household_id, v_actor_id, 'member.invited', 'member', v_member_id::text,
          format('%s invited a new %s.', v_actor_name, p_role));
  insert into public.role_notifications (household_id, audience, severity, title_key, body_key, values, entity_type, entity_id)
  values (p_household_id, p_role, 'info', 'notification.title.memberInvited', 'notification.body.memberInvited',
          jsonb_build_object('role', p_role), 'member', v_member_id::text);
  return v_token;
end;
$$;
revoke all on function public.invite_member(uuid, text) from public;
grant execute on function public.invite_member(uuid, text) to authenticated;
```

> 落地命令（与原项目一致时跳过）：
>
> ```bash
> sudo cp /tmp/taskkin-mvp/backend/supabase/migrations/0025_fix_invite_member_definer.sql \
>   /Users/jun/Documents/Project/relaycare-mvp/backend/supabase/migrations/
> ```

---

## 附录 B：模拟器构建诊断记录（2026-08-01）

| 尝试                                                         | 结果        | 失败点                                                                                         |
| ------------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------- |
| 原目录 Debug 构建                                            | ❌          | hermes-engine 脚本 `unlink 'hermes-engine/LICENSE'` EPERM（com.apple.provenance 保护）         |
| 原目录 Release 构建                                          | ❌          | openiap Swift 编译 `sandbox-exec: sandbox_apply: Operation not permitted`（provenance + 沙箱） |
| /tmp 副本（清 xattr）+ pod install                           | ✅ 副本就绪 | —                                                                                              |
| /tmp 副本 Release（openiap @TaskLocal 宏 patch 后）          | ❌          | 嵌套 xcodebuild SPM 解析 `sandbox-exec: sandbox_apply: Operation not permitted`（系统级）      |
| 最小复现：`xcrun swiftc` 编译含 `@TaskLocal` 的代码          | ❌          | `swift-plugin-server produced malformed response` + `sandbox-exec` EPERM                       |
| 直接执行 `sandbox-exec -p '(version 1)(allow default)' true` | ❌          | `sandbox_apply: Operation not permitted`，exit 71                                              |

**结论**：macOS 26 安全策略拒绝 `sandbox-exec`（App Management / provenance 机制），导致 Xcode 26.6 的 Swift 宏插件与 SPM 依赖解析全部失效。与本项目代码无关；QA_Log 记录 7/28-7/30 本机 Release 构建成功，环境在 7/31 后变化。

---

_本报告由 Reasonix 多成员评审生成：4 位并行评审成员（前端/后端/安全/发布）+ security_review ×2 + skill:review ×1 + 静态验证（tsc/lint/vitest/expo-doctor/audit）。_

---

# 附录 C：整改完成记录（2026-08-02）

依据 `docs/CODEX_REAUDIT_RESPONSE_2026-08-01.md` §5 执行完毕，全部修复经 review/security_review 复审（最终安全结论 pass，无 CRITICAL/HIGH），已落地原项目并提交。

## 第一批（上线阻断）

| 项    | 修复                                                                                                                                                                                             | 迁移/文件                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| B3    | 迁移重编号（0014→0026、0019_paywall→0027、删 0019b），0001-0031 连续                                                                                                                             | 0026/0027                   |
| B5    | IAP 环境隔离（APPLE_ACCEPTED_ENVIRONMENTS 默认仅 Production）、appAccountToken=auth.uid() 绑定、signedDate 新鲜度（purchase 24h/restore 按周期）、统一状态检查（revoked/expired 拒绝）、错误脱敏 | verify-apple-receipt + 0028 |
| B7    | 文档确认→任务创建原子 RPC（for update 防并发）                                                                                                                                                   | 0029 + actions.ts           |
| B6    | 产品决策：6 位码 + autoconfirm 接受（客户端全链路 6 位、COMPLIANCE/PROGRESS 一致声明）                                                                                                           | 客户端 + 文档               |
| B1/B2 | 0024/0025（revoke 直写 + guard triggers + invite_member definer）+ adversarial 测试脚本                                                                                                          | 0024/0025 + backend/qa/     |
| B4    | 部署手册                                                                                                                                                                                         | backend/qa/DEPLOY.md        |

## 第二批（重要级）

I1（finish 前置/restore 分类）、I2（update_my_name 显式 householdId，0031）、I4（0030 audit revoke）、I5（actor 错误态）、I6（缓存剔除 rawText + 登出清理）、I7（realtime 非静默）、I8（invite 标注）、I14（allowBackup）、I15（join advisory lock）、发布配置（版本 1.0.0、麦克风权限移除、nodePath/teamId env 参数化、CI audit 阻塞门）、_*I9（AuthScreen/OnboardingScreen 三语本地化，37 个 auth.* keys）_*

## 第三批（验收）

typecheck 0 错 / lint 0/0 / vitest 30/30 / expo-doctor 20/20 / npm audit 0 high（10 moderate Expo SDK 传递依赖）

## 落地

commit SHA：634e932(security/db) / 9314c80(iap) / a68ec12(ui) / 86425b4(chore+release) / 9cd74ae(docs)

## 剩余部署步骤（未执行，见 backend/qa/DEPLOY.md）

migration repair/push → Edge deploy + env（APPLE_ACCEPTED_ENVIRONMENTS=Production）→ adversarial 全 PASS → TestFlight 真机验收（购买/恢复/退款/删账号）

## 已知残留（非阻断）

- MEDIUM：autoconfirm + 6 位码组合下 join 限速按用户非 IP（产品决策权衡，建议后续 IP/全局限速）
- LOW：appAccountToken 续订字段需真机验证；app.json 默认本机 nodePath（env 可覆盖）；invite_member 成员数未排除 removed

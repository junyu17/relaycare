# TaskKin Care 最终上线独立审计

审计时间：2026-08-02（America/Los_Angeles）  
审计基线：`main` / `76ededa`（与 `origin/main` 一致）  
审计人：Codex（独立于此前整改记录复核）

## 结论

**结论：NO-GO，暂不应提交此工作树生成的 Archive 到 App Store Connect。**

Claude 已完成此前大部分高风险整改：远端迁移已同步至 `0032`、表级越权写已收紧、IAP JWS 校验逻辑已替换、Release bundle 与 dSYM 已恢复。此次独立审计仍发现两个直接影响上线的真实问题，以及三个不能被现有 QA 证明已完成的关键门禁。

先修复 P0-1、P0-2，并重新执行 P1-1/P1-2 所列验收后，才可以给出 GO。

## 已验证通过

| 项目                           | 结果   | 证据                                                                                                                                                        |
| ------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git/部署一致性                 | 通过   | 本地 `main` 为 `76ededa`，追踪 `origin/main`；审计开始时工作树干净。                                                                                        |
| Supabase 迁移                  | 通过   | `supabase migration list --linked` 显示远端与本地均为 `0001` 至 `0032`。                                                                                    |
| Edge Functions                 | 已部署 | `verify-apple-receipt` v15、`apple-server-notifications` v11、`delete-account` v4 均为 ACTIVE。                                                             |
| TypeScript / ESLint / 单元测试 | 通过   | `npm run typecheck`、`npm run lint` 通过；Vitest 3 文件、30 测试通过。                                                                                      |
| iOS Release 编译               | 通过   | `xcodebuild ... Release ... build` 分别完成 device 与 simulator 构建，且 app 内存在 `main.jsbundle`。                                                       |
| Archive 与 dSYM                | 通过   | 未签名审计 Archive 成功生成；Camera、React、ReactNativeDependencies、hermesvm 均在 Archive dSYMs 中。hermesvm 二进制和 dSYM UUID 相同。                     |
| 冷启动 / No script URL         | 通过   | Release app 在 iPhone 17 simulator 冷启动，进入创建/加入家庭页，未发现 `No script URL` 或 React fatal 日志。截图：`/tmp/taskkin-care-launch-audit.png`。    |
| 基础越权回归（已跑部分）       | 通过   | 远端真实账户验证：创建家庭、生成六码、households 直接升级/插入被拒、members 直接改角色/插入被拒、caregiver 合法入家后继续无法直写。临时 `qa-*` 账户已清理。 |

## 阻断项

### P0-1：读取已有家庭码会在生产远端报错

- 位置：`backend/supabase/migrations/0014_join_codes.sql:70-86`，调用方 `src/App.tsx:242-244`。
- 事实：`supabase db lint --linked --fail-on warning` 报 `public.get_household_code` 错误；真实远端账户调用返回 HTTP 400：`column reference "code" is ambiguous`（SQLSTATE `42702`）。
- 发生原因：函数的 `returns table (code text, ...)` 使 `code` 成为 PL/pgSQL 输出变量；查询内的 `select code::text` 又未给 `household_codes` 加表别名，PostgreSQL 无法判断二者。
- 用户影响：协调人每次进入有成员的家庭时，前端 effect 调用此 RPC；异常在 `catch(() => {})` 被静默吞掉，设置页不会显示当前仍有效的六码，也不会告诉用户失败。重新生成可绕开，但读取/复用已有码的核心入家路径不可靠。
- 整改：新增 `0033_fix_get_household_code.sql`，将查询写为 `from public.household_codes as hc` 和 `select hc.code::text, hc.expires_at`；部署后用真实 coordinator 验证“生成 -> 重新加载页面 -> 读取同一码 -> caregiver 加入”。前端必须改为显示错误，而不是空 catch。

### P0-2：真实 Archive 的原生发布配置没有与 app.json 同步

- 配置声明：`app.json:6` 为版本 `1.0.0`，`app.json:31` 已声明 `microphonePermission: false`。
- 真实产物：本次 Release build 和 Archive 的 `Info.plist` 都是 `CFBundleShortVersionString = 0.1.0`，且仍有 `NSMicrophoneUsageDescription`。
- 发生原因：这是预生成的 Expo iOS 工程；只改 `app.json` 不会自动重写 `ios/TaskKinCare/Info.plist`。此前清单也写了“需 prebuild”，但当前提交没有产生该原生变更。
- 用户/上架影响：Xcode Archive 将以 `0.1.0 (1)` 提交而非计划中的 `1.0.0 (1)`；无用的麦克风权限也会触发 App Review 的用途核查。项目文档宣称这两项已经完成，与真实 Archive 不一致。
- 整改：在干净工作树执行受控的 `npx expo prebuild --clean -p ios`，核对 config plugin 没有丢失 JS bundle fallback/dSYM build phase，执行 `pod install`；提交生成的 `ios/` 改动。随后重新 Archive，并从 `.xcarchive/Products/Applications/TaskKinCare.app/Info.plist` 复核版本和权限，不能只看 app.json。

## 必须补齐的上线门禁

### P1-1：对抗 QA 脚本未完整运行，不能作为“18/18 PASS”证据

- 位置：`backend/qa/adversarial_tests.sh`。
- 本次实际结果：脚本完成了注册、建家庭、加入码、B1、B2、caregiver 直写拒绝、viewer 任务直写拒绝；随后在 viewer documents 断言附近停止，没有输出 `PASS=... FAIL=...` 或清理段。脚本遗留的临时 `qa-*` 用户已由本次审计清理。
- 判断：不论停止的底层原因是什么，当前脚本没有可靠地完成或报告最终门禁结果，不能继续写作“全部 PASS”。现有脚本也不会覆盖 document 原子确认、任务/时间线创建、删除账号、家庭切换以及 IAP 真实交易。
- 整改：用 `bash -x` 在隔离项目复现并修复退出点；添加 `trap` 清理临时账户；所有 HTTP 请求设置超时并保存请求名称/状态；让脚本在任何失败后仍输出总结。修复后用真实远端跑完并保存完整日志，至少覆盖 coordinator/caregiver/viewer 的正向和越权路径。

### P1-2：IAP 尚无真机 TestFlight 端到端验收

- 已确认：源码包含 Production-only 环境选择、`appAccountToken = auth.uid()`、JWS 新鲜度检查和 finish-before-verify；线上 Functions 为 ACTIVE。
- 未确认：TestFlight 的购买、恢复购买、自动续订字段、退款/撤销通知、删除账号后的订阅归属。
- 特别注意：生产 secret 被设计为仅接受 `Production`。TestFlight 交易是 `Sandbox`，所以真机验收必须使用隔离 Supabase 项目，或受控地短时启用 Sandbox 并在验收后立即恢复 Production-only；不能把宽松设置遗留在正式环境。
- 整改：先记录当前生产 secret 策略，建立测试环境或变更窗口；按月付和年付分别完成购买/恢复；在 Apple Sandbox 退款后验证 entitlement 回收；保存 transaction/originalTransactionId 与 Edge Function 日志中已脱敏的结果。完成后恢复 `APPLE_ACCEPTED_ENVIRONMENTS=Production`，再次用 Sandbox JWS 证明生产拒绝。

### P1-3：公开法律链接本地存在，但当前无法证明公网可访问

- `site/privacy*.html` 和 `site/terms*.html` 六个文件均存在且非空；app 指向 `https://junyu17.github.io/relaycare/...`。
- 本审计环境对三个 GitHub Pages URL 的 HTTP 请求均得到状态 `000`，浏览器抓取也被环境安全策略拒绝，因此这不是“页面已失效”的证据，也不能当作“公网正常”的证据。
- 整改：在真机 Safari 与非本机网络分别打开 Privacy / Terms 三语链接，确认 HTTP 200、内容可见、切换语言可用；将截图和时间写入 QA log。此项是 App Review 提交前必须做的人为验收。

## 非阻断但必须进入整改队列

| 优先级 | 问题                                   | 影响与建议                                                                                                                                                                                                                                      |
| ------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2     | `npm run format:check` 失败            | 8 个文件未通过 Prettier，包括 `src/App.tsx`、`src/auth/AuthScreen.tsx`、`src/i18n.ts` 和 IAP Edge 文件。CI 未运行 format check，因此主分支可以携带此失败。格式化这些文件并在 `.github/workflows/ci.yml` 加入 `npm run format:check`。           |
| P2     | 三条云写入仍不是原子事务               | `src/lib/actions.ts:139-177`（时间线 -> 审计 -> 通知）、`180-194`（偏好 -> 审计）、`286-309`（报告通知 -> 审计）仍是多个客户端请求。弱网时可出现业务记录已写但审计/通知缺失。按已完成的 `confirm_document_and_create_task` 模式分别收敛到 RPC。 |
| P2     | CI SAST 仍允许失败                     | `.github/workflows/ci.yml:44` 有 `continue-on-error: true`。至少在上线分支改成阻断，或把已接受的规则显式排除，不能默默忽略新的高风险发现。                                                                                                      |
| P2     | 原生构建仍依赖本机默认路径             | `app.json:37-38` 保留具体 Team ID 和 `/Users/jun/.hermes/node/bin/node`。插件支持环境变量覆盖，但默认仍使 EAS/其他电脑不稳定。应从发布配置移除本机绝对路径，并在本机 `.xcode.env.local` 或 CI secret 注入。                                     |
| P2     | 依赖审计仍有 10 个 moderate            | `npm audit --omit=dev --audit-level=high` 因无 high 而退出 0，但报告 `uuid` 经 Expo CLI 链路带来的 10 个 moderate。不要执行会降级 Expo 的 `npm audit fix --force`；建立 Expo SDK 升级跟踪并在每次升级重验。                                     |
| P3     | 模拟器有 StoreKit / Notifications 日志 | simulator 出现 StoreKit queue Sandbox error 与 Expo notifications Keychain error；这是未登录 Sandbox 与模拟器 keychain 限制，未出现红屏或 JS bundle 错误。真机仍需重新验收通知与 IAP。                                                          |

## UI 与流程复核

- Release simulator 冷启动呈现 Create/Join、三语切换、输入框和按钮，截图中没有遮挡、裁切或 `No script URL` 红屏。
- 这只覆盖登录后的 Onboarding 首屏；因为未使用真实 UI 自动化输入，尚未覆盖键盘弹出后的表单可见性、二维码扫描授权、创建任务、编辑名称、时间线、成员移除、Paywall 和删除账号。P1-1 的重新设计脚本应配合真机手工 checklist 覆盖这些路径。
- `get_household_code` 的 UI 调用当前静默失败，是本次发现中唯一已用真实远端确认的核心 UI/后端故障。

## 本次命令与结果摘要

```text
npm run typecheck                         PASS
npm run lint                              PASS
npm test                                  PASS (30 tests)
npx expo install --check                  PASS
npm audit --omit=dev --audit-level=high  PASS exit code; 10 moderate reported
npm run format:check                      FAIL (8 files)
supabase migration list --linked          PASS (0001-0032 aligned)
supabase db lint --linked                 FAIL (get_household_code ambiguous code)
Release iPhone device build               PASS; main.jsbundle present
Release iPhone simulator build + launch   PASS; onboarding rendered
Release Archive (unsigned audit archive)  PASS; required dSYMs present
```

## 放行条件

1. 交付并部署 `0033_fix_get_household_code.sql`，修掉 UI 静默错误，并以 coordinator/caregiver 真实账户验证读码和加入。
2. 重新生成 iOS 工程，提交生成的原生变更；重新 Archive 并验 `.xcarchive` 内为 `1.0.0 (1)`、无 `NSMicrophoneUsageDescription`。
3. 修复对抗 QA 脚本并跑出完整最终结果与自动清理证据。
4. 完成真机 TestFlight IAP 购买、恢复、退款/撤销以及删除账号验收，并将 Production-only 设置恢复后复核。
5. 在真实网络验证六个公开法律页，并把结果写入 `docs/QA_Log.md`。

在以上五项完成之前，本审计不建议上传或提交审核。

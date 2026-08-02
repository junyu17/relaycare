# TaskKin Care 上线前复核报告

复核时间：2026-08-02（America/Los_Angeles）
复核基线：`main` / `02b3281`（与 `origin/main` 一致）
复核范围：上轮最终审计整改、远端 Supabase、Release Archive、家庭多用户权限、CI 与公开法律页发布链路。

## 结论

**核心整改已生效；QA 脚本 P1 已关闭（2026-08-02 更新），当前结论为 CONDITIONAL GO（仅剩两个真机外部验收）。**

上轮的两个 P0 已经在真实产物和远端数据库中复核通过：已有家庭码可读取；Archive 的版本、JS bundle、权限声明和四个 dSYM 均正确。使用真实远端临时账号的 coordinator/caregiver/viewer 验证也证明关键越权路径被拒绝。

~~仍不能标为无条件上线……QA 脚本 P1 缺口~~ **已修复并关闭**（2026-08-02，见下）：`backend/qa/adversarial_tests.sh` 修复了重复 INSERT 与 auth.users.id/members.id 混淆（commit 1730120），带 SERVICE_ROLE 完整重跑 **PASS=25 FAIL=0**（第 10 节越权/removed 用例真实执行，0 遗留 QA 用户）。剩余外部验收：IAP 真机 TestFlight 与真机 Safari 法律页访问。

## 已验证通过

| 项目                    | 结果 | 本次证据                                                                                                                                                                                                               |
| ----------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1：已有家庭码读取    | 通过 | `0033_fix_get_household_code.sql` 已远端部署；真实 coordinator 流程中 `get_household_code` 返回与刚生成的 6 位码一致。                                                                                                 |
| 远端迁移与模式          | 通过 | `supabase migration list --linked` 显示 `0001` 至 `0033` 本地/远端一致；`supabase db lint --linked --fail-on warning` 为 0 错误。                                                                                      |
| 多用户权限              | 通过 | caregiver 以真实 6 位码加入后，使用真实 `members.id` 调用 `update_member_role`、`dissolve_household`、`invite_member` 均返回 HTTP 400；viewer 新建任务返回 HTTP 403；被移除 caregiver 读取原家庭返回 `[]` / HTTP 200。 |
| 临时数据清理            | 通过 | 两轮远端测试后，所有带 `qa-` 前缀、时间戳后缀的本轮 coordinator、caregiver、viewer 测试账户均已清理，账户数为 0。                                                                                                      |
| P0-2：原生 Archive 配置 | 通过 | 新 Archive 内 `TaskKinCare.app/Info.plist` 是 `1.0.0 (1)`，不存在 `NSMicrophoneUsageDescription`，并包含 `main.jsbundle`。                                                                                             |
| dSYM 上传前置条件       | 通过 | `ExpoCameraBarcodeScanning`、`React`、`ReactNativeDependencies`、`hermesvm` 均有 dSYM；每个 framework 二进制 UUID 与其 dSYM UUID 完全一致。                                                                            |
| 本地质量门禁            | 通过 | `format:check`、TypeScript、ESLint、Vitest（3 文件 / 30 测试）和 `expo install --check` 全部通过。                                                                                                                     |
| GitHub CI               | 通过 | 当前 `02b3281` 的 CI 成功；workflow 已实际阻断 format、production high+ dependency audit 与 Semgrep。                                                                                                                  |
| 法律页发布物            | 通过 | GitHub Pages 最近部署成功；`site/` 自该部署提交以来没有变更；9 个公开页面的站内相对链接检查为 0 错误。                                                                                                                 |

## 待整改或人工验收

### ~~P1：对抗 QA 脚本仍不能作为上线门禁~~ → **已关闭（2026-08-02，见 QA_Log §adversarial 完整门禁 PASS=25 FAIL=0）**

- 位置：`backend/qa/adversarial_tests.sh:32-41`、`158-201`。
- 复现：脚本已完成前 19 个断言和 `get_household_code` 回归后，在非 coordinator 段停止于 `POST /rest/v1/members`，没有输出 `PASS=... FAIL=...`、没有进入显式清理段。
- 发生原因：caregiver 已在第 5 段通过 `join_by_code` 成功写入 `members`；第 10 段又以 service role 向 `(household_id, user_id)` 唯一键重复插入同一成员。该请求没有响应处理，脚本把其丢弃。`--max-time` 只限制了等待时间，不能让错误的测试设计变成有效门禁。
- 额外缺口：第 10 段把 `auth.users.id` (`G_UID`) 传给 `update_member_role`，但函数需要的是 `public.members.id`。因此即使请求立刻返回非 2xx，也只是在测“成员不存在”，并未实际证明 caregiver 不能提升角色。
- 整改：删除重复 INSERT；以 service role 查询 caregiver 的 `members.id`；对每个请求保存 HTTP 状态并断言；`trap` 中 coordinator 应先经 `delete-account` 清理其家庭，再删其余测试用户；无论失败与否均打印最终汇总。修复后重新跑脚本，保存完整日志，才可作为自动化上线门禁。

### P1：IAP 仍需真机 TestFlight 闭环

- 已确认：两项 Apple Edge Function 均为 ACTIVE；当前 JWS 代码和前端错误提示已部署。
- 未确认：TestFlight Sandbox 的首次购买、恢复购买、自动续订、退款/撤销 Server Notification 与删除账号后的订阅归属。
- 验收要求：使用隔离 Supabase 项目或受控短时 Sandbox 开关测试；完成后将正式环境恢复为 `APPLE_ACCEPTED_ENVIRONMENTS=Production`，再验证 Sandbox JWS 被正式环境拒绝。不要在生产长期允许 Sandbox。

### P1：法律链接需在真机 Safari 最后确认

- 本次通过 GitHub API 确认 Pages 已部署、HTTPS 强制开启，且当前 `site/` 与已部署提交相同；本地所有公开页面存在且链接完整。
- 本审计环境访问 GitHub Pages 时被网络层 `connection reset` 拦截，不能据此判断页面失败，也不能替代用户网络。
- 提交前在 iPhone Safari 分别打开 Privacy Policy 与 Terms of Service 的 EN / 中文 / ES 链接，确认加载、语言切换和返回 App 均正常，并记录截图。

## 非阻断风险

| 优先级 | 问题                                                                                                                                              | 建议                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| P2     | 时间线写入仍是“写 event -> 写 audit -> 写通知”三个客户端请求（`src/lib/actions.ts:139-177`）。弱网时前一个成功、后一个失败会留下不完整审计/通知。 | 参照已存在的 document+task RPC，改为单一 security-definer RPC 和事务。           |
| P2     | `toggleDigest` 也是“更新偏好 -> 写 audit”两个客户端请求（`src/lib/actions.ts:180-194`）。                                                         | 合并到 RPC，保证偏好与审计同成同败。                                             |
| P2     | 生产依赖审计在官方 npm registry 报 10 个 moderate `uuid` 间接依赖问题；high+ 门禁通过。                                                           | 不要运行会强制降级 Expo 的 `npm audit fix --force`；随 Expo SDK 升级处理并复测。 |
| P3     | 通知权限、前台本地通知与跳转订阅管理页仍是 best-effort，不会向用户显示失败。                                                                      | 这适合非关键能力；在真机通知测试时确认系统拒绝权限时页面仍可正常使用。           |

## 放行条件

1. ~~修正并完整跑通 `backend/qa/adversarial_tests.sh`~~ **已完成（2026-08-02）：PASS=25 FAIL=0，0 遗留 QA 用户。**
2. 在 TestFlight 真机完成 IAP 购买、恢复、续订/撤销通知与删除账号流程。
3. 在真机 Safari 打开六个法律页。

在这三项完成后，当前代码、远端迁移、Archive 和家庭权限可以放行提交审核。

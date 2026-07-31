# TaskKin Care Backend (Supabase)

方案 C 的后端：Supabase（Postgres + Auth + Realtime）。解决"换手机/删 app 数据还在"和"家庭多成员共享"。

## 目录结构

```
backend/supabase/migrations/
  0001_init_schema.sql     # 表结构（households/members/tasks/events/documents/audit 等）
  0002_rls_and_rpc.sql     # RLS 家庭隔离 + current_household_id + create_household/accept_invite RPC + realtime
  0003_seed_roles.sql      # coordinator/caregiver/viewer 角色权限种子
  0004_storage.sql         # 私有文档 bucket 与存储路径
  0005_role_rbac.sql       # 数据库层三角色最小权限策略
  0006_task_activity_rpc.sql # P0 任务流、审计、通知原子事务 RPC
  0007_invite_tokens.sql   # 邀请 token 安全（独立 invites 表 + accept_invite 凭 token）
  0008_paywall.sql         # Family Plus 付费墙：entitlement 列 + 服务端硬配额 RPC
  0009_realtime_households.sql # households 加入实时发布（购买后刷新套餐徽章）
  0010_paywall_service_role.sql # service_role 可调 set_household_plus（校验 Edge Function 用）
  0011_paywall_security.sql  # P0 安全加固（收回 authenticated、显式到期时间、subscriptions 表、删账号）
  0012_subscription_binding.sql # Apple 原始交易与登录协调人/家庭的不可转移绑定
  0013_multi_households.sql  # Family Plus 最多三个家庭：活动家庭上下文与订阅权益覆盖
  0014_join_codes.sql        # 6 位家庭加入码 + 匿名成员加入 + 成员退出/移除/解散
  0015_member_notifications.sql # 成员变动通知（加入/退出通知协调人；解散/移除通知成员）
  0016_document_raw_text.sql  # 持久化 OCR 原始文本，文档页可显示识别结果
  0017_delete_task_timeline.sql # 删除误建的 task / timeline 事件（带归属校验+审计）
  0018_update_my_name.sql      # 成员自助修改显示名
```

## 数据模型 → Postgres 映射

| App 类型 (types.ts)    | Postgres 表              | 说明                                |
| ---------------------- | ------------------------ | ----------------------------------- |
| Household              | households               | created_by → auth.users             |
| Member                 | members                  | user_id → auth.users（null=待邀请） |
| RoleDefinition         | role_definitions         | 全局只读                            |
| NotificationPreference | notification_preferences | 按 member                           |
| RoleNotification       | role_notifications       | 按 household                        |
| Task                   | tasks                    | 含 subtasks(jsonb)                  |
| CareEvent              | care_events              |                                     |
| DocumentRecord         | documents                | 非 PHI 元数据                       |
| AuditEvent             | audit_events             | 只增不改                            |

## 安全分层（重要）

- **DB 层（RLS）**：按 `household_id` 隔离，并在 `0005` 强制 coordinator / caregiver / viewer 的最小读写边界。家庭 A 绝对看不到家庭 B；Viewer 不能通过 API 读取任务、文件或审计记录。
- **App 层（hasPermission）**：提供对应的界面与交互保护；不是唯一的授权边界。
- P0 任务创建、认领、拒绝、交接、完成由 `0006` 的事务 RPC 写入任务、审计和通知，避免该核心闭环出现部分写入。文档确认与任务创建仍是后续应收敛的路径。

## 关键 RPC

- `create_household(...)`：注册用户一次性建家庭 + 自己的 coordinator 成员 + 通知偏好 + 审计。绕过 RLS 解决"首条 member 写入"问题。
- `accept_invite(p_invite_token, p_display_name)`：被邀请人注册后凭邀请链接里的 token 加入家庭，校验 token 有效 + 未接受 + 未过期。token 存于独立 invites 表，不经 API 可读（防止同家庭其他成员冒用）。
- `list_my_households()` / `set_active_household(...)`：列出当前账号的家庭，并安全切换当前工作家庭；RLS 与角色 RPC 都只使用该活动家庭。
- `create_task_with_activity(...)`：原子创建任务、审计记录和照护者通知。
- `transition_task_with_activity(...)`：原子认领、拒绝、交接或完成任务，并生成对应审计和角色通知。

## 实时同步

`0002` 把 7 张业务表加入 `supabase_realtime` publication。app 端用 supabase channel 订阅，多设备实时同步。

## 部署（待实例就绪后执行）

```bash
# 方式一：Supabase CLI（推荐，本地或 CI）
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push            # 执行 migrations

# 方式二：Supabase Dashboard → SQL Editor → 按编号依次执行 0001 到 0018
```

> 新 Supabase 项目已完成 `0001` 到 `0006` 的迁移与角色 API 验收。上线前需补执行 `0007_invite_tokens.sql`（邀请 token 安全）。不要只执行旧版 `all_in_one.sql`，它没有包含 storage、RBAC、原子任务 RPC 或邀请 token。

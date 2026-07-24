# RelayCare Backend (Supabase)

方案 C 的后端：Supabase（Postgres + Auth + Realtime）。解决"换手机/删 app 数据还在"和"家庭多成员共享"。

## 目录结构

```
backend/supabase/migrations/
  0001_init_schema.sql     # 表结构（households/members/tasks/events/documents/audit 等）
  0002_rls_and_rpc.sql     # RLS 家庭隔离 + current_household_id + create_household/accept_invite RPC + realtime
  0003_seed_roles.sql      # coordinator/caregiver/viewer 角色权限种子
```

## 数据模型 → Postgres 映射

| App 类型 (types.ts) | Postgres 表 | 说明 |
| --- | --- | --- |
| Household | households | created_by → auth.users |
| Member | members | user_id → auth.users（null=待邀请） |
| RoleDefinition | role_definitions | 全局只读 |
| NotificationPreference | notification_preferences | 按 member |
| RoleNotification | role_notifications | 按 household |
| Task | tasks | 含 subtasks(jsonb) |
| CareEvent | care_events | |
| DocumentRecord | documents | 非 PHI 元数据 |
| AuditEvent | audit_events | 只增不改 |

## 安全分层（重要）

- **DB 层（RLS）**：按 `household_id` 隔离。用户只能读写自己所属家庭的数据。家庭 A 绝对看不到家庭 B。
- **App 层（hasPermission）**：角色权限（coordinator 能改角色、viewer 只读等）在 app 端 `domain.ts` 强制。
- MVP 取舍：DB 层不做角色级 RLS（策略会过于复杂），靠 app 层 + RLS 家庭隔离组合。后续如需更强可加 DB 角色策略。

## 关键 RPC

- `create_household(...)`：注册用户一次性建家庭 + 自己的 coordinator 成员 + 通知偏好 + 审计。绕过 RLS 解决"首条 member 写入"问题。
- `accept_invite(p_member_id, p_display_name)`：被邀请人注册后凭邀请链接加入家庭，校验 pending + 未过期。

## 实时同步

`0002` 把 7 张业务表加入 `supabase_realtime` publication。app 端用 supabase channel 订阅，多设备实时同步。

## 部署（待实例就绪后执行）

```bash
# 方式一：Supabase CLI（推荐，本地或 CI）
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push            # 执行 migrations

# 方式二：Supabase Dashboard → SQL Editor → 依次粘贴执行 0001/0002/0003
```

> migrations **尚未在任何实例上执行验证**（开发实例待定，见 PROGRESS.md）。实例就绪后需跑一次并核对无报错。

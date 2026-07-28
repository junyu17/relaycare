# 首页/Auth UX 修复（2026-07-26）

> 本轮针对登录/注册/建家庭首页的 4 项 UX 问题。验证：`tsc` 0 · `eslint` 0/0 · `prettier` 全过 · `vitest` 20/20。
> 配套 diff：`docs/diffs/auth-ux-fixes.diff`（覆盖 `src/auth/AuthScreen.tsx`、`src/auth/AuthContext.tsx`、`src/i18n.ts` 三个文件自上次提交以来的全部改动；其中也含上一轮的邀请 token 重构，本文档只描述本轮 4 项 UX 修复）。

## 角色定义说明（回答"一共定义了几个角色"）

系统定义 **3 个角色**：`coordinator`（协调人）、`caregiver`（照护协助者）、`viewer`（查看者）。权限在 `src/data.ts` 的 `roleDefinitions` 与后端 `0003_seed_roles.sql` + `0005_role_rbac.sql` 双层强制。业务规则：**家庭的首个创建者只能是 Coordinator**（`create_household` RPC 固定写入 coordinator），其余成员由协调人邀请时指定 caregiver/viewer。

---

## 修复 1：登录页增加"忘记密码"

- **文件**：`src/auth/AuthContext.tsx`、`src/auth/AuthScreen.tsx`
- **问题**：登录页无密码重置入口。
- **改动**：
  - `AuthContext` 新增 `resetPassword(email)`，调用 `supabase.auth.resetPasswordForEmail(email)`。
  - `AuthScreen` 的 `mode` 增加 `"reset"`；登录态下显示 "Forgot password?" 链接 -> 进入重置态；重置态只输入邮箱，点 "Send reset link" 发送重置邮件，成功后提示并返回登录态；提供 "Back to sign in" 返回。
- **关键代码**（AuthContext）：
  ```ts
  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
  };
  ```
- **注意**：Supabase 端需在 Auth 设置里启用密码重置邮件模板（默认已开启）。重置邮件里的回调链接需配合 deep link / 托管页面，目前走 Supabase 默认重定向页。

## 修复 2：注册时显示密码要求提示

- **文件**：`src/auth/AuthScreen.tsx`
- **问题**：注册时无密码要求提示，用户不知最低长度（Supabase 默认 ≥6 位）。
- **改动**：注册态下在密码输入框下方显示提示 `"Password must be at least 6 characters."`。
- **关键代码**：
  ```tsx
  {
    mode === "signup" && <Text style={s.hint}>Password must be at least 6 characters.</Text>;
  }
  ```
- **注意**：6 位是 Supabase 默认下限；若后台调高策略，需同步更新该提示文案。

## 修复 3：建家庭流程增加角色选择框 + 首创建者说明

- **文件**：`src/auth/AuthScreen.tsx`（OnboardingScreen create 分支）
- **问题**：建家庭时未展示角色，用户不知有几种角色、自己是什么角色。
- **改动**：在 create 表单加入"Your role (3 roles available)"选择框，列出 Coordinator / Caregiver / Viewer 三个角色；Coordinator 为选中态且整组禁用（首创建者只能是 Coordinator），下方说明：
  > "The first member of a household is always the Coordinator. You can invite Caregivers and Viewers later from Settings."
- **关键代码**：
  ```tsx
  <Text style={s.fieldLabel}>Your role (3 roles available)</Text>
  <View style={s.roleRow}>
    {ROLE_OPTIONS.map((r) => {
      const selected = r === "coordinator";
      return (
        <View key={r} style={[s.roleChip, selected && s.roleChipActive, s.roleChipDisabled]} ...>
          <Text style={selected ? s.roleChipTextActive : s.roleChipText}>{ROLE_LABEL[r]}</Text>
        </View>
      );
    })}
  </View>
  <Text style={s.hint}>The first member of a household is always the Coordinator. ...</Text>
  ```
- **说明**：选择框为禁用态是业务规则使然（`create_household` RPC 固定 coordinator）。被邀请加入者无此页，其角色由协调人邀请时决定。

## 修复 4：角色名首字母大写

- **文件**：`src/i18n.ts`
- **问题**：首页角色卡片（`App.tsx` actor chip 用 `roleShortLabel`）显示小写 "coordinator/caregiver/viewer"。
- **改动**：将 EN 的 `role.short.*` 全部首字母大写：
  | key                      | 旧          | 新          |
  | ------------------------ | ----------- | ----------- |
  | `role.short.coordinator` | coordinator | Coordinator |
  | `role.short.caregiver`   | caregiver   | Caregiver   |
  | `role.short.family`      | family      | Family      |
  | `role.short.helper`      | helper      | Helper      |
  | `role.short.viewer`      | viewer      | Viewer      |
- **影响面**：`App.tsx:637` 角色卡片现在显示 "Coordinator/Caregiver/Viewer"。中文/西语短标签本就无大小写概念，无需改动。

---

## 验证

| 检查                 | 结果                |
| -------------------- | ------------------- |
| `tsc --noEmit`       | 0 错误              |
| `eslint .`           | 0 error / 0 warning |
| `prettier --check .` | 全部通过            |
| `vitest run`         | 20/20               |

## 待办/备注

- AuthScreen 仍为纯英文（与现状一致，未引入翻译器）；如需三语，可后续把 AuthScreen 接入 `makeTranslator`。
- 密码重置的回调落地页（点击邮件链接后的"输入新密码"页）目前依赖 Supabase 默认托管页；若要 app 内承接，需另加 deep link 处理（后续增强）。
- 未做 git 提交；如需我按"上一轮 5 项 + 本轮 4 项"分两个提交记录，告诉我即可。

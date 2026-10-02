# pending_migrations：写好了、但还不能 `db push` 的迁移

`supabase db push` 只读 `../migrations/`。这里的文件要等到各自的上线时机，才移进 `migrations/`（文件名不变）再 push：

| 文件                                | 什么时候移进 migrations/                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `0060_bind_before_invite.sql`       | 1.10 审核通过当天：先 push 0060，再在 App Store Connect 点发布（报错文案让用户「更新并用 Apple 登录」）  |
| `0061_anonymous_retention.sql`      | 1.10 发布后一周内，和 `purge-abandoned-anonymous` 函数一起                                               |
| `0062_schedule_anonymous_purge.sql` | 0061 上线、函数部署、Vault 存好 `SUPABASE_URL` / `CRON_SECRET`，并且只读核对过候选账号（数量、类别）之后 |

本地测试不用等：`bash backend/qa/local_pg.sh` 会把这里的文件接在 `migrations/` 后面另建一个库，跑 `qa/sql/40_*`、`50_*`。

-- 0048: SYNC_FIX_REVIEW S1/S2 —— 0045/0047 的 replica identity 修正
--
-- S1: members 是硬删（0011:149 删账号 / 0014:194,223 退出、移除 / 0015:119,159 覆盖版），
--     0045 注释误判为软删（实际只有 invite_status 业务标记，行被 delete 移除），
--     导致移除成员/退出后其他设备不刷新（与 tasks 原始问题相同）。
alter table public.members replica identity full;

-- S2: audit_events 由 cleanup_audit_by_retention()（0040）每日 03:00 UTC 批量删除过期审计，
--     FULL 会让每删一行都触发所有在线客户端一次全量 refetch（刷新风暴）。
--     客户端不需要感知保留期清理（不可见后台维护），回退为 default。
alter table public.audit_events replica identity default;

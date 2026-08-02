-- 0027: tighten paywall RPC execution privileges.（原 0019_paywall_rpc_permissions，2026-08-02 重编号修复 B3 冲突）
-- Mobile clients must purchase through verify-apple-receipt; only service_role
-- may write paid entitlements or subscription records directly.

revoke all on function public.set_household_plus(uuid, text, uuid, timestamptz) from public;
revoke all on function public.set_household_plus(uuid, text, uuid, timestamptz) from anon;
revoke all on function public.set_household_plus(uuid, text, uuid, timestamptz) from authenticated;
grant execute on function public.set_household_plus(uuid, text, uuid, timestamptz) to service_role;

revoke all on function public.register_apple_subscription(uuid, text, text, timestamptz, text, text, uuid, uuid) from public;
revoke all on function public.register_apple_subscription(uuid, text, text, timestamptz, text, text, uuid, uuid) from anon;
revoke all on function public.register_apple_subscription(uuid, text, text, timestamptz, text, text, uuid, uuid) from authenticated;
grant execute on function public.register_apple_subscription(uuid, text, text, timestamptz, text, text, uuid, uuid)
  to service_role;

revoke all on function public.sync_subscription_by_transaction(text, text, timestamptz, text, text) from public;
revoke all on function public.sync_subscription_by_transaction(text, text, timestamptz, text, text) from anon;
revoke all on function public.sync_subscription_by_transaction(text, text, timestamptz, text, text) from authenticated;
grant execute on function public.sync_subscription_by_transaction(text, text, timestamptz, text, text) to service_role;

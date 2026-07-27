-- 0010: 允许校验 Edge Function（service role）调用 set_household_plus 写入 entitlement。
-- service role 绕过 RLS；调用方为后端校验函数，可信。
-- 上线前应再 `revoke execute on function public.set_household_plus(uuid, text, uuid) from authenticated;`
-- （仅留 service_role），以防客户端直接自行升级。
grant execute on function public.set_household_plus(uuid, text, uuid) to service_role;

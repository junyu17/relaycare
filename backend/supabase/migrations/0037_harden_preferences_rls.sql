-- 0037: 收紧 notification_preferences 客户端直写（R5 门禁补漏，IOS_SUBMISSION_DEV_SPEC）
--
-- 0036 只收紧了 update_notification_preference RPC 的套餐门禁，但 0005:95 的
-- `preferences: update own or coordinator` 表级策略仍允许 authenticated 经 REST 直 PATCH
-- 自己的 notification_preferences 行（如 task_digest=true），绕过 'Family Plus required'，
-- AC5-1"服务端为权威"不成立。
-- 修复：撤销客户端对 notification_preferences 的 INSERT/UPDATE 表级权限；所有偏好写必须
-- 走 update_notification_preference（security definer，RPC 内部以 postgres 身份执行不受影响）；
-- SELECT 保留（0005:85 own/coordinator 策略），客户端 getNotificationPreference 仍可用。
revoke insert, update on table public.notification_preferences from anon, authenticated;

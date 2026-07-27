-- 0009: 把 households 加入实时发布，使购买后 set_household_plus 更新 plus_plan 时
-- 客户端能收到变更并刷新套餐徽章/配额。
alter publication supabase_realtime add table public.households;

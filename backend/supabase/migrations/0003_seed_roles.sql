-- TaskKin Care MVP - seed role definitions
-- 与 src/data.ts initialState.roleDefinitions 保持一致；app 端 hasPermission 也读这份权限。

insert into public.role_definitions (role, label, permissions) values
  ('coordinator', 'Coordinator',
   '["household:manage","member:invite","member:role_update","task:create","task:claim","task:handoff","task:complete","timeline:read","timeline:add","document:upload","document:read","report:export","audit:read"]'::jsonb),
  ('caregiver', 'Caregiver',
   '["task:create","task:claim","task:handoff","task:complete","timeline:read","timeline:add","document:upload","document:read","report:export"]'::jsonb),
  ('viewer', 'Viewer',
   '["timeline:read"]'::jsonb)
on conflict (role) do nothing;

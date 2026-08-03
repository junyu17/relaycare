-- 0046: 幂等索引改非部分（REST .upsert() 的 ON CONFLICT inference 不支持部分索引 WHERE）
-- 0045 建了部分唯一索引，客户端 upsert onConflict 会报 "no unique constraint matching"。
-- 非部分索引下 NULL 值天然不冲突（owner_id 可空、client_request_id 可空），语义等价。
drop index if exists tasks_request_dedup_idx;
create unique index tasks_request_dedup_idx on public.tasks (requested_by_id, client_request_id);
drop index if exists care_events_request_dedup_idx;
create unique index care_events_request_dedup_idx on public.care_events (owner_id, client_request_id);

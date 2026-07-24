-- 0004: document object storage (Supabase Storage)
-- 需在 Dashboard SQL Editor 执行（anon 无权建 bucket/policy）。
-- 执行后 app 端 addDocument 会把文件上传到 storage，元数据存 documents.storage_path。

-- 1. private bucket
insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict (id) do nothing;

-- 2. documents 表加 storage_path
alter table public.documents add column if not exists storage_path text;

-- 3. storage policy: 家庭成员可读写自己家庭的文件（path 第一段 = household_id）
create policy "documents storage: household read" on storage.objects
  for select using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_household_id()::text
  );
create policy "documents storage: household write" on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_household_id()::text
  );
create policy "documents storage: household delete" on storage.objects
  for delete using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_household_id()::text
  );

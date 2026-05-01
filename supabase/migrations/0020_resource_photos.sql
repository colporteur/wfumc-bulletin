-- =====================================================================
-- Photo resource type + image storage
--
-- Adds a 'photo' option to resource_type. For photo resources:
--   - image_path holds the storage path (e.g., "<owner>/<resource_id>.jpg")
--   - content becomes optional (it's the caption)
--
-- Storage:
--   resource-images bucket — public-read so signed-in pastors can render
--   them inline. Insert/update/delete gated to authenticated users; path
--   prefix not enforced at the DB level (the app puts files under
--   <user_id>/<resource_id>/ for organization, not security).
-- =====================================================================

-- 1. Extend the resource_type CHECK constraint
alter table public.resources
  drop constraint if exists resources_resource_type_check;

alter table public.resources
  add constraint resources_resource_type_check
  check (resource_type in (
    'story', 'quote', 'illustration', 'joke', 'note', 'photo'
  ));

-- 2. Add image storage path
alter table public.resources
  add column if not exists image_path text;

-- 3. Storage bucket for resource images (mirror bulletin-images pattern)
insert into storage.buckets (id, name, public, file_size_limit)
values ('resource-images', 'resource-images', true, 10485760) -- 10 MB
on conflict (id) do update
  set public = true,
      file_size_limit = 10485760;

-- Public read (anyone with the URL can see the image — same as bulletin
-- cover photos; this is fine for sermon-prep stock).
drop policy if exists "Public can read resource-images" on storage.objects;
create policy "Public can read resource-images"
  on storage.objects for select
  using (bucket_id = 'resource-images');

-- Any authenticated user can upload/update/delete. We keep this loose
-- because library membership is checked at the row layer (resources
-- table) — the storage object just holds bytes.
drop policy if exists "Authenticated can insert resource-images" on storage.objects;
create policy "Authenticated can insert resource-images"
  on storage.objects for insert
  with check (bucket_id = 'resource-images' and auth.role() = 'authenticated');

drop policy if exists "Authenticated can update resource-images" on storage.objects;
create policy "Authenticated can update resource-images"
  on storage.objects for update
  using (bucket_id = 'resource-images' and auth.role() = 'authenticated');

drop policy if exists "Authenticated can delete resource-images" on storage.objects;
create policy "Authenticated can delete resource-images"
  on storage.objects for delete
  using (bucket_id = 'resource-images' and auth.role() = 'authenticated');

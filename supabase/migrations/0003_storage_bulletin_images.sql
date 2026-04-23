-- =====================================================================
-- Storage bucket for bulletin images
--
-- Holds cover photos and any other images that show up in the bulletin
-- (e.g., flyer images for Other blocks down the road). Public-read so
-- the worshipper view can fetch images without authentication.
-- =====================================================================

-- Create the bucket (idempotent — won't error if it already exists)
insert into storage.buckets (id, name, public, file_size_limit)
values ('bulletin-images', 'bulletin-images', true, 10485760) -- 10 MB
on conflict (id) do update
  set public = true,
      file_size_limit = 10485760;

-- =====================================================================
-- RLS policies on storage.objects, scoped to this bucket only.
-- Public read; staff insert/update/delete.
-- (DROP IF EXISTS first so this migration can be re-run safely.)
-- =====================================================================

drop policy if exists "Public can read bulletin-images" on storage.objects;
create policy "Public can read bulletin-images"
  on storage.objects for select
  using (bucket_id = 'bulletin-images');

drop policy if exists "Staff can insert into bulletin-images" on storage.objects;
create policy "Staff can insert into bulletin-images"
  on storage.objects for insert
  with check (bucket_id = 'bulletin-images' and public.is_staff());

drop policy if exists "Staff can update bulletin-images" on storage.objects;
create policy "Staff can update bulletin-images"
  on storage.objects for update
  using (bucket_id = 'bulletin-images' and public.is_staff());

drop policy if exists "Staff can delete bulletin-images" on storage.objects;
create policy "Staff can delete bulletin-images"
  on storage.objects for delete
  using (bucket_id = 'bulletin-images' and public.is_staff());

-- =====================================================================
-- Pastoral Records — Phase 6: End-of-life prep
--
-- New per-person fields:
--   death_date              — when the person died
--   obituary_url            — link to an external obituary (funeral
--                             home page, newspaper, etc.)
--   obituary_storage_path   — uploaded obituary file (PDF, .docx,
--                             scanned image — anything in the new
--                             pastoral-documents bucket)
--   eulogy_notes            — pastor's running notes for a future
--                             eulogy. Editable any time, deceased or
--                             not — sometimes the pastor knows it's
--                             coming.
--
-- Plus a new private storage bucket pastoral-documents — used here
-- for the obituary file, and re-used in Phase 7 for the documents /
-- screenshots / files archive (#21).
--
-- The is_deceased flag from Phase 1 is the toggle. This phase fleshes
-- out what happens when that toggle is on.
-- =====================================================================

alter table public.pastoral_people
  add column if not exists death_date date,
  add column if not exists obituary_url text,
  add column if not exists obituary_storage_path text,
  add column if not exists eulogy_notes text;

-- Anniversary-style lookup: who died around (today)? Mirrors the index
-- on pastoral_significant_deaths for the same dashboard surface later.
create index if not exists pastoral_people_owner_death_idx
  on public.pastoral_people (owner_user_id, death_date)
  where is_deceased = true;

-- Storage bucket — same private path-prefix pattern as pastoral-photos.
-- Files live at <owner_user_id>/<person_id>/...
-- Increased file-size cap to 25 MB since obituary scans / printable PDFs
-- can be larger than photos.

insert into storage.buckets (id, name, public, file_size_limit)
values ('pastoral-documents', 'pastoral-documents', false, 26214400) -- 25 MB
on conflict (id) do update
  set public = false,
      file_size_limit = 26214400;

drop policy if exists "Pastoral docs read by owner folder" on storage.objects;
create policy "Pastoral docs read by owner folder"
  on storage.objects for select
  using (
    bucket_id = 'pastoral-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Pastoral docs insert by owner folder" on storage.objects;
create policy "Pastoral docs insert by owner folder"
  on storage.objects for insert
  with check (
    bucket_id = 'pastoral-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Pastoral docs update by owner folder" on storage.objects;
create policy "Pastoral docs update by owner folder"
  on storage.objects for update
  using (
    bucket_id = 'pastoral-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Pastoral docs delete by owner folder" on storage.objects;
create policy "Pastoral docs delete by owner folder"
  on storage.objects for delete
  using (
    bucket_id = 'pastoral-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

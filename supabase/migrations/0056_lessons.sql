-- =====================================================================
-- Lesson Maker — Phase A schema
--
-- A Bible-study / Sunday-school lesson library. Phase A is the bare
-- lesson row + its attached images. Later phases add:
--   - lesson_revisions  (Phase B — Workspace chat-revise snapshots)
--   - lesson_groups, lesson_group_members  (Phase C — rosters)
--   - lesson_uses  (Phase C — "Tuesday group used this on Sep 12,
--                              picked by Mary")
--   - lesson_queue  (Phase D — upcoming-ideas queue per group)
--
-- All tables are RLS-locked to auth.uid() = owner_user_id; the app
-- itself is pastor-only by route gate, matching the suite's other
-- private apps.
-- =====================================================================

-- 1. lessons ---------------------------------------------------------

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  -- The discussion question or title that anchors the lesson.
  title text,

  -- Scripture reference for the lesson (e.g., "Luke 15:11-32"). Free
  -- text so chapter/verse, multiple passages, or "(none)" all work.
  scripture_reference text,

  -- The main lesson body — the question, discussion prompts, teaching
  -- text. Plain text with blank-line paragraph breaks; the docx
  -- exporter renders it as continuous paragraphs.
  body text,

  -- Theme tags for filtering on the list page later. Lowercase
  -- single-word or short-phrase tags (e.g., {forgiveness, lent,
  -- prodigal-son}). Defaults to an empty array.
  themes text[] not null default '{}',

  -- "Class notes" — short announcements that appear NEAR THE TOP of
  -- the generated Word doc above the lesson body. Used for things like
  -- "We will not meet next week" or "Bring a covered dish".
  -- Deliberately separate from the lesson body so it can be cleared
  -- between uses without touching the lesson content.
  class_notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger lessons_updated_at
  before update on public.lessons
  for each row execute function set_updated_at();

create index if not exists lessons_owner_recent_idx
  on public.lessons (owner_user_id, created_at desc);
-- Theme filtering on the list page later.
create index if not exists lessons_owner_themes_idx
  on public.lessons using gin (themes);

alter table public.lessons enable row level security;

create policy "Lessons read by owner"
  on public.lessons for select
  using (auth.uid() = owner_user_id);
create policy "Lessons insert by owner"
  on public.lessons for insert
  with check (auth.uid() = owner_user_id);
create policy "Lessons update by owner"
  on public.lessons for update
  using (auth.uid() = owner_user_id);
create policy "Lessons delete by owner"
  on public.lessons for delete
  using (auth.uid() = owner_user_id);

-- 2. lesson_images ---------------------------------------------------
--
-- Multiple images per lesson, mirroring the resource_images pattern.
-- Useful for printed handouts that include diagrams or photos, and
-- needed at bulk-import time for the existing 100+ Word docs that
-- have embedded images.

create table if not exists public.lesson_images (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  -- Denormalized owner for cheap RLS checks (always matches the parent).
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  image_path text not null,
  sort_order int not null default 0,
  caption text,
  -- Stable SHA-256 of the image bytes; lets the bulk-import flow
  -- re-run safely without duplicating images in a lesson.
  content_hash text,

  created_at timestamptz not null default now()
);

create index if not exists lesson_images_lesson_idx
  on public.lesson_images (lesson_id, sort_order);
create index if not exists lesson_images_owner_idx
  on public.lesson_images (owner_user_id);
-- Within one lesson, the same image (by hash) shouldn't get inserted
-- twice. Allows the import to re-run safely.
create unique index if not exists lesson_images_dedupe_uniq
  on public.lesson_images (lesson_id, content_hash)
  where content_hash is not null;

alter table public.lesson_images enable row level security;

-- All four policies use the simple owner_user_id check because lessons
-- are pastor-only (no library sharing model yet — that may come in
-- Phase G if we add a participant-facing surface).
create policy "Lesson images read by owner"
  on public.lesson_images for select
  using (auth.uid() = owner_user_id);
create policy "Lesson images insert by owner"
  on public.lesson_images for insert
  with check (auth.uid() = owner_user_id);
create policy "Lesson images update by owner"
  on public.lesson_images for update
  using (auth.uid() = owner_user_id);
create policy "Lesson images delete by owner"
  on public.lesson_images for delete
  using (auth.uid() = owner_user_id);

-- 3. Storage bucket --------------------------------------------------
--
-- Public-read bucket (matches resource-images convention) so the app
-- can use plain <img src="..."> without minting signed URLs. The
-- lesson_images table's RLS still keeps row visibility pastor-only,
-- and the storage paths are unguessable (random suffix), so even
-- public-read storage is safe in practice.
--
-- If Phase G adds a participant-facing app, we can revisit and either
-- keep this bucket public (intentional for sharing) or migrate to
-- private + signed URLs (if we want stricter access control).
--
-- Path layout: <owner_user_id>/<lesson_id>/<timestamp>-<rand>.<ext>
-- 10 MB per-file cap (same as resource-images).

insert into storage.buckets (id, name, public, file_size_limit)
values ('lesson-images', 'lesson-images', true, 10485760)
on conflict (id) do update
  set public = true,
      file_size_limit = 10485760;

drop policy if exists "Public can read lesson-images" on storage.objects;
create policy "Public can read lesson-images"
  on storage.objects for select
  using (bucket_id = 'lesson-images');

drop policy if exists "Authenticated can insert lesson-images" on storage.objects;
create policy "Authenticated can insert lesson-images"
  on storage.objects for insert
  with check (bucket_id = 'lesson-images' and auth.role() = 'authenticated');

drop policy if exists "Authenticated can update lesson-images" on storage.objects;
create policy "Authenticated can update lesson-images"
  on storage.objects for update
  using (bucket_id = 'lesson-images' and auth.role() = 'authenticated');

drop policy if exists "Authenticated can delete lesson-images" on storage.objects;
create policy "Authenticated can delete lesson-images"
  on storage.objects for delete
  using (bucket_id = 'lesson-images' and auth.role() = 'authenticated');

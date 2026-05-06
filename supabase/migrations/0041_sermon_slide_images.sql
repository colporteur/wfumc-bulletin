-- =====================================================================
-- Sermon slide deck — finished JPG/PNG images
--
-- Separate concept from workspace_slides. Where workspace_slides holds
-- slide CONTENT (title + body the pastor authored / Claude proposed),
-- this table holds the FINISHED visual artifacts: the actual JPGs the
-- pastor exported from PowerPoint after polishing the deck visually.
--
-- Workflow:
--   1. Author slides in workspace_slides (manual or via Claude).
--   2. Insert <SLIDE #N – Description> markers into the manuscript
--      (use the "Insert markers" button on the slides panel).
--   3. Open the deck in PowerPoint, polish visuals.
--   4. PowerPoint File → Export → JPG → Save All Slides.
--   5. Upload the JPGs back here. Each gets matched to a marker in
--      the manuscript by upload order, with manual override.
--   6. The reconciliation page lets the pastor adjust matches, drop
--      bad ones, add new markers, etc.
--
-- Storage: sermon-slide-decks bucket, path layout
--   <owner_user_id>/<sermon_id>/<timestamp>-<random>.<ext>
-- Public-read (anyone with the URL can see the image — same as
-- resource-images / bulletin-images), with authenticated writes.
-- =====================================================================

create table if not exists public.sermon_slide_images (
  id uuid primary key default gen_random_uuid(),
  sermon_id uuid not null references public.sermons(id) on delete cascade,
  -- Denormalized owner for cheap RLS checks (matches parent sermon).
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  -- Position in the finished deck (1, 2, 3, ...). Edited via reorder.
  sort_order int not null default 0,

  -- Storage path of the uploaded JPG (or PNG). Required.
  image_path text not null,
  -- Original filename (e.g. "Slide7.JPG") so reconciliation can use
  -- PowerPoint's natural sequence as a tiebreaker.
  original_filename text,

  -- Reconciliation: which manuscript marker this image corresponds to.
  -- Both nullable so an image can exist without being matched yet
  -- (newly uploaded or marker-was-deleted).
  matched_marker_number int,
  matched_marker_description text,

  -- Optional pastor note for this slide image.
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger sermon_slide_images_updated_at
  before update on public.sermon_slide_images
  for each row execute function set_updated_at();

create index if not exists sermon_slide_images_sermon_idx
  on public.sermon_slide_images (sermon_id, sort_order);
create index if not exists sermon_slide_images_owner_idx
  on public.sermon_slide_images (owner_user_id);

alter table public.sermon_slide_images enable row level security;

create policy "Slide images read by owner or staff"
  on public.sermon_slide_images for select
  using (auth.uid() = owner_user_id or is_staff());
create policy "Slide images insert by owner or staff"
  on public.sermon_slide_images for insert
  with check (auth.uid() = owner_user_id or is_staff());
create policy "Slide images update by owner or staff"
  on public.sermon_slide_images for update
  using (auth.uid() = owner_user_id or is_staff());
create policy "Slide images delete by owner or staff"
  on public.sermon_slide_images for delete
  using (auth.uid() = owner_user_id or is_staff());

-- Storage bucket for the JPGs. Mirrors the resource-images pattern:
-- public read for easy <img src="..."> rendering, authenticated writes.
insert into storage.buckets (id, name, public, file_size_limit)
values ('sermon-slide-decks', 'sermon-slide-decks', true, 20971520) -- 20 MB per file
on conflict (id) do update
  set public = true,
      file_size_limit = 20971520;

drop policy if exists "Public can read sermon-slide-decks" on storage.objects;
create policy "Public can read sermon-slide-decks"
  on storage.objects for select
  using (bucket_id = 'sermon-slide-decks');

drop policy if exists "Authenticated can insert sermon-slide-decks" on storage.objects;
create policy "Authenticated can insert sermon-slide-decks"
  on storage.objects for insert
  with check (
    bucket_id = 'sermon-slide-decks'
    and auth.role() = 'authenticated'
  );

drop policy if exists "Authenticated can update sermon-slide-decks" on storage.objects;
create policy "Authenticated can update sermon-slide-decks"
  on storage.objects for update
  using (
    bucket_id = 'sermon-slide-decks'
    and auth.role() = 'authenticated'
  );

drop policy if exists "Authenticated can delete sermon-slide-decks" on storage.objects;
create policy "Authenticated can delete sermon-slide-decks"
  on storage.objects for delete
  using (
    bucket_id = 'sermon-slide-decks'
    and auth.role() = 'authenticated'
  );

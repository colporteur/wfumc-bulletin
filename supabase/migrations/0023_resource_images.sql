-- =====================================================================
-- Multi-image support for resources
--
-- Replaces the single-image-per-resource model (resources.image_path)
-- with a proper resource_images table. Any resource type can now have
-- multiple supporting images:
--   - Illustrations with diagrams
--   - Quotes with scanned book pages
--   - Stories with photos
--   - Photo type still works (the image IS the primary content)
--
-- Sort order determines which is the thumbnail in list views and
-- which appears first in the gallery on detail views.
--
-- Images live in the existing resource-images storage bucket, stored
-- under <owner_user_id>/<resource_id>/<filename>.
-- =====================================================================

create table if not exists public.resource_images (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete cascade,
  -- Denormalized owner for cheap RLS checks (matches the parent resource).
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  image_path text not null,
  sort_order int not null default 0,
  caption text,
  -- Stable hash of the image bytes; lets us dedupe re-imports of the
  -- same image into the same resource without manual cleanup.
  content_hash text,
  created_at timestamptz not null default now()
);

create index if not exists resource_images_resource_idx
  on public.resource_images (resource_id, sort_order);
create index if not exists resource_images_owner_idx
  on public.resource_images (owner_user_id);
-- Within one resource, the same image (by hash) shouldn't get inserted
-- twice. Allows the import to re-run safely.
create unique index if not exists resource_images_dedupe_uniq
  on public.resource_images (resource_id, content_hash)
  where content_hash is not null;

alter table public.resource_images enable row level security;

-- Read: visible if you can see the parent resource (owner OR library
-- member). We mirror the resources policy via an EXISTS subquery rather
-- than re-implementing the logic here.
create policy "Resource image read by parent visibility"
  on public.resource_images for select
  using (
    exists (
      select 1 from public.resources r
      where r.id = resource_images.resource_id
        and (
          r.owner_user_id = auth.uid()
          or (r.library_id is not null and is_library_member(r.library_id))
          or is_staff()
        )
    )
  );

-- Insert/update/delete: same as resource update permissions (anyone who
-- can edit the parent can manage its images).
create policy "Resource image insert by parent writers"
  on public.resource_images for insert
  with check (
    exists (
      select 1 from public.resources r
      where r.id = resource_images.resource_id
        and (
          r.owner_user_id = auth.uid()
          or (r.library_id is not null and is_library_member(r.library_id))
          or is_staff()
        )
    )
  );

create policy "Resource image update by parent writers"
  on public.resource_images for update
  using (
    exists (
      select 1 from public.resources r
      where r.id = resource_images.resource_id
        and (
          r.owner_user_id = auth.uid()
          or (r.library_id is not null and is_library_member(r.library_id))
          or is_staff()
        )
    )
  );

create policy "Resource image delete by parent writers"
  on public.resource_images for delete
  using (
    exists (
      select 1 from public.resources r
      where r.id = resource_images.resource_id
        and (
          r.owner_user_id = auth.uid()
          or (r.library_id is not null and is_library_member(r.library_id))
          or is_staff()
        )
    )
  );

-- Migrate existing photos: copy resources.image_path → resource_images
-- with sort_order = 0 (so they remain the primary image).
insert into public.resource_images (resource_id, owner_user_id, image_path, sort_order)
select id, owner_user_id, image_path, 0
from public.resources
where image_path is not null
  and not exists (
    select 1 from public.resource_images ri
    where ri.resource_id = resources.id
      and ri.image_path = resources.image_path
  );

-- Drop the legacy column. All image access now goes through
-- resource_images.
alter table public.resources drop column if exists image_path;

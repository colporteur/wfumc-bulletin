-- =====================================================================
-- Social media posts
--
-- Backend table for the WFUMC Social Media app — a workspace for
-- composing posts (Facebook, Instagram, X, etc.), tracking them
-- through a status workflow, and tying each one back to its source
-- material (a bulletin's response prompt, a sermon, or an uploaded
-- image).
--
-- This MVP is a draft + copy/paste workflow, NOT direct API posting.
-- The team composes here, marks status, then copies the final text
-- and posts manually on each platform. Avoids OAuth integrations,
-- platform content reviews, and accidental auto-posts.
--
-- Status workflow: draft → ready → posted → archived
--   draft     — actively being written / iterated
--   ready     — approved, queued for posting
--   posted    — manually marked as posted (records when)
--   archived  — kept for history but out of the active queue
--
-- Source linkage: each post knows what it was written ABOUT, so the
-- team can browse "posts about <sermon>" or "posts from <bulletin>".
-- =====================================================================

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft' check (status in (
    'draft', 'ready', 'posted', 'archived'
  )),
  -- Internal label for the team (NOT post text). Optional.
  title text,
  -- The actual post text. Stored as a single body for MVP — per-platform
  -- variants can come later as a separate table if needed.
  body text not null default '',
  -- Optional uploaded image for the post (path in social-images bucket).
  image_path text,
  -- Where this post came from. Drives which related row is shown in the
  -- detail view ("Drafted from <sermon>" / "Bulletin response prompt").
  source_type text not null default 'manual' check (source_type in (
    'manual', 'free_form', 'response_prompt', 'sermon', 'image_upload'
  )),
  source_bulletin_id uuid references public.bulletins(id) on delete set null,
  source_sermon_id uuid references public.sermons(id) on delete set null,
  -- Date the team intends to post this. Pure metadata — no scheduler.
  scheduled_for date,
  -- When the team marked this as actually posted.
  posted_at timestamptz,
  -- Platforms this post is targeted to / was posted on. Free-form text
  -- array so we don't need a migration to add a new platform.
  platforms text[] not null default '{}',
  -- Internal team notes (not the post text).
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger social_posts_updated_at before update on public.social_posts
  for each row execute function set_updated_at();

create index if not exists social_posts_owner_idx
  on public.social_posts (owner_user_id);
create index if not exists social_posts_status_idx
  on public.social_posts (status);
create index if not exists social_posts_scheduled_idx
  on public.social_posts (scheduled_for desc nulls last);
create index if not exists social_posts_source_bulletin_idx
  on public.social_posts (source_bulletin_id) where source_bulletin_id is not null;
create index if not exists social_posts_source_sermon_idx
  on public.social_posts (source_sermon_id) where source_sermon_id is not null;

alter table public.social_posts enable row level security;

-- Read: owner OR staff. The social media team are typically staff,
-- which lets them collaborate on each other's drafts.
create policy "Social post read by owner or staff"
  on public.social_posts for select
  using (auth.uid() = owner_user_id or is_staff());

create policy "Social post insert by owner or staff"
  on public.social_posts for insert
  with check (auth.uid() = owner_user_id or is_staff());

create policy "Social post update by owner or staff"
  on public.social_posts for update
  using (auth.uid() = owner_user_id or is_staff());

create policy "Social post delete by owner or staff"
  on public.social_posts for delete
  using (auth.uid() = owner_user_id or is_staff());

-- =====================================================================
-- Storage bucket for post images
--
-- Mirrors the resource-images / bulletin-images pattern. Public-read
-- (so previews render anywhere); inserts/updates/deletes require an
-- authenticated session.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('social-images', 'social-images', true, 10485760) -- 10 MB
on conflict (id) do update
  set public = true,
      file_size_limit = 10485760;

drop policy if exists "Public can read social-images" on storage.objects;
create policy "Public can read social-images"
  on storage.objects for select
  using (bucket_id = 'social-images');

drop policy if exists "Authenticated can insert social-images" on storage.objects;
create policy "Authenticated can insert social-images"
  on storage.objects for insert
  with check (bucket_id = 'social-images' and auth.role() = 'authenticated');

drop policy if exists "Authenticated can update social-images" on storage.objects;
create policy "Authenticated can update social-images"
  on storage.objects for update
  using (bucket_id = 'social-images' and auth.role() = 'authenticated');

drop policy if exists "Authenticated can delete social-images" on storage.objects;
create policy "Authenticated can delete social-images"
  on storage.objects for delete
  using (bucket_id = 'social-images' and auth.role() = 'authenticated');

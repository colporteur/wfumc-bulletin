-- =====================================================================
-- Resource library: stories / quotes / illustrations / jokes / notes
--
-- A multi-tenant archive of sermon-prep building blocks. Each pastor
-- (Todd, his wife, etc.) builds and searches their own library. When
-- the pastor uses a resource in a sermon, we record the link via
-- sermon_resources so:
--   - From a resource: "Used in: <list of sermons>" (so a story isn't
--     repeated at the same church)
--   - From a sermon:   "Resources used" panel (so prep notes are
--     attached to the work)
--
-- Claude-assisted tagging happens client-side via the claude-proxy
-- edge function — this schema just stores whatever the user accepted.
-- =====================================================================

-- 1. resources — the library itself
create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  -- Categorical type lets the user filter "just stories" vs "just quotes".
  -- Constrained to a small set; adding new types is a migration.
  resource_type text not null check (resource_type in (
    'story', 'quote', 'illustration', 'joke', 'note'
  )),
  -- Short title / handle. Optional — quotes often don't have one.
  title text,
  -- The actual content. For quotes, the quote text. For stories, the
  -- story. For notes, the note. Kept as text (not jsonb) so it's
  -- searchable and Claude-analyzable as-is.
  content text not null,
  -- Attribution. Who said this, where it's from. Free-form so it can
  -- handle book-and-page, person-and-context, "personal experience", etc.
  source text,
  source_url text,
  -- Themes / tags. Postgres text[] so we get cheap exact-match filtering
  -- with a GIN index. Free-form values; Claude suggests them but the
  -- user accepts/edits.
  themes text[] not null default '{}',
  -- Free-form scripture connections (e.g., "Mark 12:28-34; Romans 13:8").
  scripture_refs text,
  -- Tone descriptor — "humorous", "somber", "hopeful", "convicting", etc.
  tone text,
  -- Private notes about this resource (use cases, where it landed well,
  -- where it bombed). Not for the body.
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger resources_updated_at before update on public.resources
  for each row execute function set_updated_at();

create index if not exists resources_owner_idx
  on public.resources (owner_user_id);
create index if not exists resources_type_idx
  on public.resources (resource_type);
create index if not exists resources_themes_gin
  on public.resources using gin (themes);
create index if not exists resources_created_idx
  on public.resources (created_at desc);

alter table public.resources enable row level security;

create policy "Resource read by owner or staff"
  on public.resources for select
  using (auth.uid() = owner_user_id or is_staff());

create policy "Resource insert by owner or staff"
  on public.resources for insert
  with check (auth.uid() = owner_user_id or is_staff());

create policy "Resource update by owner or staff"
  on public.resources for update
  using (auth.uid() = owner_user_id or is_staff());

create policy "Resource delete by owner or staff"
  on public.resources for delete
  using (auth.uid() = owner_user_id or is_staff());

-- 2. sermon_resources — junction: which resources were used in which sermons
create table if not exists public.sermon_resources (
  id uuid primary key default gen_random_uuid(),
  sermon_id uuid not null references public.sermons(id) on delete cascade,
  resource_id uuid not null references public.resources(id) on delete cascade,
  -- Denormalized owner for cheap RLS — must match the sermon's and
  -- resource's owner (enforced at app layer; adding triggers feels heavy).
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  -- How it was used: brief context. Optional.
  used_notes text,
  created_at timestamptz not null default now()
);

-- A resource shouldn't be linked to the same sermon twice.
create unique index if not exists sermon_resources_uniq
  on public.sermon_resources (sermon_id, resource_id);

create index if not exists sermon_resources_sermon_idx
  on public.sermon_resources (sermon_id);
create index if not exists sermon_resources_resource_idx
  on public.sermon_resources (resource_id);
create index if not exists sermon_resources_owner_idx
  on public.sermon_resources (owner_user_id);

alter table public.sermon_resources enable row level security;

create policy "Sermon resource read by owner or staff"
  on public.sermon_resources for select
  using (auth.uid() = owner_user_id or is_staff());

create policy "Sermon resource insert by owner or staff"
  on public.sermon_resources for insert
  with check (auth.uid() = owner_user_id or is_staff());

create policy "Sermon resource update by owner or staff"
  on public.sermon_resources for update
  using (auth.uid() = owner_user_id or is_staff());

create policy "Sermon resource delete by owner or staff"
  on public.sermon_resources for delete
  using (auth.uid() = owner_user_id or is_staff());

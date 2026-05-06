-- =====================================================================
-- Sermon stashed blocks
--
-- "Saved for next time" sermon-prose blocks. The pastor generates them
-- via the Pair-with-Scripture flow on a resource detail page (a
-- resource + a scripture → Claude returns a self-contained sermon
-- block) and chooses to attach the block to an existing sermon for
-- the next preaching of that sermon, rather than weaving it into the
-- current manuscript.
--
-- Especially useful when the target sermon is locked: a brand-new
-- block worth saving doesn't have to wait for an unlock just to be
-- recorded against the right sermon.
--
-- A block is "live" until the pastor either deletes it or marks it
-- used (used_at non-null). The display card hides used blocks by
-- default but they remain in the table for history.
-- =====================================================================

create table if not exists public.sermon_stashed_blocks (
  id uuid primary key default gen_random_uuid(),
  sermon_id uuid not null references public.sermons(id) on delete cascade,
  -- Denormalized owner for cheap RLS (matches the parent sermon's owner).
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  -- Optional short label the pastor sees in the list. The block body
  -- is the actual prose.
  title text,
  body text not null,

  -- Provenance: free-form description ("Pair with Scripture: Acts
  -- 17:22-31") plus optional structured FK back to the source resource
  -- and the scripture string used at generation time.
  source text,
  source_resource_id uuid references public.resources(id) on delete set null,
  source_scripture text,

  -- Soft-archive timestamp. NULL = stashed and waiting; non-null =
  -- used (the pastor incorporated it or decided not to). Hidden by
  -- default in the UI but retained.
  used_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger sermon_stashed_blocks_updated_at
  before update on public.sermon_stashed_blocks
  for each row execute function set_updated_at();

create index if not exists sermon_stashed_blocks_sermon_idx
  on public.sermon_stashed_blocks (sermon_id, created_at desc);
create index if not exists sermon_stashed_blocks_owner_idx
  on public.sermon_stashed_blocks (owner_user_id);
-- Cheap "live blocks per sermon" lookup for the card.
create index if not exists sermon_stashed_blocks_live_idx
  on public.sermon_stashed_blocks (sermon_id)
  where used_at is null;

alter table public.sermon_stashed_blocks enable row level security;

create policy "Stashed blocks read by owner or staff"
  on public.sermon_stashed_blocks for select
  using (auth.uid() = owner_user_id or is_staff());
create policy "Stashed blocks insert by owner or staff"
  on public.sermon_stashed_blocks for insert
  with check (auth.uid() = owner_user_id or is_staff());
create policy "Stashed blocks update by owner or staff"
  on public.sermon_stashed_blocks for update
  using (auth.uid() = owner_user_id or is_staff());
create policy "Stashed blocks delete by owner or staff"
  on public.sermon_stashed_blocks for delete
  using (auth.uid() = owner_user_id or is_staff());

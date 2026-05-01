-- =====================================================================
-- Sermons: multi-version + import support
--
-- Background: Pastor Todd has been tracking 400+ sermons in a spreadsheet
-- where each sermon has a stable "Sermon Number" and may have been
-- preached multiple times across multiple churches (each preaching with
-- its own date, location, possibly an adapted title).
--
-- This migration:
--   1. Adds richer metadata columns to `sermons` (matching the spreadsheet)
--   2. Creates a `preachings` table — one row per actual preaching event
--   3. Backfills existing liturgy_items.sermon_id linkages into preachings
--   4. Adds idempotent dedupe constraints so the import can be run twice
--
-- After this, the conceptual model is:
--   sermons       — canonical works (a sermon you wrote)
--   preachings    — events of preaching that work (date + location)
--   liturgy_items — bulletin entries that reference a sermon (a preaching
--                   in our system)
-- =====================================================================

-- 1. Extend sermons with import metadata
alter table public.sermons
  add column if not exists original_sermon_number integer,
  add column if not exists strength integer check (strength >= 1 and strength <= 10),
  add column if not exists timeless text,
  add column if not exists is_eulogy boolean not null default false,
  add column if not exists major_stories text,
  add column if not exists lectionary_year text;

-- Unique on the original spreadsheet number when present, so import is
-- idempotent (re-running won't create duplicates).
create unique index if not exists sermons_original_number_uniq
  on public.sermons (original_sermon_number)
  where original_sermon_number is not null;

-- 2. Preachings table — each preaching event of a sermon
create table if not exists public.preachings (
  id uuid primary key default gen_random_uuid(),
  sermon_id uuid not null references public.sermons(id) on delete cascade,
  preached_at date,
  location text,
  title_used text,
  series text,
  notes text,
  -- Link to a bulletin if this preaching is in our app (nullable —
  -- historical preachings won't have a bulletin row).
  bulletin_id uuid references public.bulletins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger preachings_updated_at before update on public.preachings
  for each row execute function set_updated_at();

create index if not exists preachings_sermon_idx
  on public.preachings (sermon_id);

create index if not exists preachings_preached_at_idx
  on public.preachings (preached_at desc nulls last);

create index if not exists preachings_location_idx
  on public.preachings (lower(location));

-- Dedupe key: a sermon shouldn't be recorded as preached at the same
-- (location, date) twice. NULLs are treated as not-equal so we still
-- allow multiple "unknown date" preachings.
create unique index if not exists preachings_dedupe_uniq
  on public.preachings (sermon_id, preached_at, lower(location))
  where preached_at is not null and location is not null;

alter table public.preachings enable row level security;

create policy "Anyone can read preachings of published bulletins or via staff"
  on public.preachings for select
  using (
    is_staff()
    or exists (
      select 1
      from public.bulletins b
      where b.id = preachings.bulletin_id
        and b.status = 'published'
    )
  );

create policy "Staff can write preachings"
  on public.preachings for all
  using (is_staff()) with check (is_staff());

-- 3. Backfill: every existing liturgy_item with a sermon_id becomes
--    a preachings row. The bulletin's service_date becomes preached_at.
insert into public.preachings (sermon_id, preached_at, location, bulletin_id, title_used)
select
  li.sermon_id,
  b.service_date,
  'Wedowee First UMC' as location,  -- our church; historical imports will use the spreadsheet's location
  b.id as bulletin_id,
  s.title as title_used
from public.liturgy_items li
join public.bulletins b on b.id = li.bulletin_id
left join public.sermons s on s.id = li.sermon_id
where li.sermon_id is not null
  and not exists (
    select 1 from public.preachings p
    where p.bulletin_id = b.id and p.sermon_id = li.sermon_id
  );

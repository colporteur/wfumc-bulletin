-- =====================================================================
-- Public archive: include historical WFUMC sermons
--
-- Pastor Todd's spreadsheet import added preachings without bulletin_id
-- (events that pre-date this app). The first version of the public
-- WFUMC sermon archive only showed sermons linked to a published
-- bulletin, so those historical preachings were invisible to
-- worshippers.
--
-- This migration:
--   1. Adds an is_at_our_church flag on preachings
--   2. Backfills it true for:
--        - any preaching with bulletin_id (it's in our system)
--        - any preaching whose location matches a Wedowee* pattern
--   3. Updates RLS so anon readers can see preachings + sermons that
--      have ANY preaching flagged is_at_our_church (not just bulletin
--      ones).
--
-- Each app decides who's "us"; the bulletin app code uses this flag
-- to power the worshipper-facing /sermons archive.
-- =====================================================================

alter table public.preachings
  add column if not exists is_at_our_church boolean not null default false;

-- Backfill: every preaching tied to a bulletin in our system is by
-- definition at our church.
update public.preachings
set is_at_our_church = true
where bulletin_id is not null
  and is_at_our_church = false;

-- Backfill: imported historical preachings whose location names look
-- like Wedowee. We catch the common variants ("Wedowee", "Wedowee FUMC",
-- "Wedowee First UMC", etc.) with a single LIKE.
update public.preachings
set is_at_our_church = true
where location is not null
  and lower(location) like '%wedowee%'
  and is_at_our_church = false;

create index if not exists preachings_at_our_church_idx
  on public.preachings (is_at_our_church)
  where is_at_our_church = true;

-- Update RLS so anonymous worshippers can read these preachings + the
-- sermons they belong to.
drop policy if exists "Sermon read access" on public.sermons;
create policy "Sermon read access"
  on public.sermons for select
  using (
    auth.uid() = owner_user_id
    or is_staff()
    or exists (
      select 1
      from public.liturgy_items li
      join public.bulletins b on b.id = li.bulletin_id
      where li.sermon_id = sermons.id
        and b.status = 'published'
    )
    or exists (
      select 1
      from public.preachings p
      where p.sermon_id = sermons.id
        and p.is_at_our_church = true
    )
  );

drop policy if exists "Preaching read access" on public.preachings;
create policy "Preaching read access"
  on public.preachings for select
  using (
    auth.uid() = owner_user_id
    or is_staff()
    or is_at_our_church = true
    or exists (
      select 1 from public.bulletins b
      where b.id = preachings.bulletin_id
        and b.status = 'published'
    )
  );

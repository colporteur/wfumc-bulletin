-- =====================================================================
-- Sermons multi-tenant + public WFUMC sermon archive
--
-- Background:
--   Pastor Todd's wife is also a preacher (different churches). Both
--   want to use the Sermon Archive app + the upcoming Resource Library.
--   Sermons need an owner so each user sees only their own.
--
--   Worshippers at WFUMC also want a public-facing sermon archive
--   listing all sermons preached at WFUMC, sorted by date.
--
-- This migration:
--   1. Adds owner_user_id to sermons and preachings
--   2. Backfills owner = the pastor (existing data is all Todd's)
--   3. Updates RLS so owners can fully manage their own sermons,
--      staff can still read/write all (for bulletin pick-existing
--      flows including guest preachers), and anon can read sermons of
--      published bulletins (for the public archive).
-- =====================================================================

-- 1. Add owner columns
alter table public.sermons
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null;

alter table public.preachings
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null;

create index if not exists sermons_owner_idx on public.sermons (owner_user_id);
create index if not exists preachings_owner_idx on public.preachings (owner_user_id);

-- 2. Backfill: set existing sermons' owner to the WFUMC pastor.
--    (All existing data was authored by Pastor Todd via the bulletin
--    app or imported from his personal sermon database.)
update public.sermons
set owner_user_id = (
  select sp.user_id
  from public.staff_profiles sp
  where sp.role = 'pastor'
  limit 1
)
where owner_user_id is null;

-- Preachings inherit their sermon's owner.
update public.preachings p
set owner_user_id = s.owner_user_id
from public.sermons s
where p.sermon_id = s.id
  and p.owner_user_id is null;

-- 3. RLS — sermons
drop policy if exists "Anyone can read sermons of published bulletins" on public.sermons;
drop policy if exists "Staff can write sermons" on public.sermons;
drop policy if exists "Owners can write their sermons" on public.sermons;
drop policy if exists "Owners can read their sermons" on public.sermons;

-- Read access: owner OR staff OR anyone if linked to a published bulletin
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
  );

-- Insert: any authenticated user, but they must set themselves as owner
create policy "Sermon insert by owner"
  on public.sermons for insert
  with check (auth.uid() = owner_user_id or is_staff());

-- Update: owner OR staff
create policy "Sermon update by owner or staff"
  on public.sermons for update
  using (auth.uid() = owner_user_id or is_staff());

-- Delete: owner OR staff
create policy "Sermon delete by owner or staff"
  on public.sermons for delete
  using (auth.uid() = owner_user_id or is_staff());

-- 4. RLS — preachings
drop policy if exists "Anyone can read preachings of published bulletins or via staff" on public.preachings;
drop policy if exists "Staff can write preachings" on public.preachings;

create policy "Preaching read access"
  on public.preachings for select
  using (
    auth.uid() = owner_user_id
    or is_staff()
    or exists (
      select 1 from public.bulletins b
      where b.id = preachings.bulletin_id
        and b.status = 'published'
    )
  );

create policy "Preaching insert by owner or staff"
  on public.preachings for insert
  with check (auth.uid() = owner_user_id or is_staff());

create policy "Preaching update by owner or staff"
  on public.preachings for update
  using (auth.uid() = owner_user_id or is_staff());

create policy "Preaching delete by owner or staff"
  on public.preachings for delete
  using (auth.uid() = owner_user_id or is_staff());

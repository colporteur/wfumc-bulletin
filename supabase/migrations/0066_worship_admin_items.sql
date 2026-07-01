-- =====================================================================
-- Worship Admin Items — Phase 1 schema
--
-- A new pipeline for the *third* kind of thing a pastor's Plaud recording
-- routinely surfaces (alongside pastoral encounters and sermon
-- illustrations): administrative church conversations. Scheduling, staff
-- coordination, program planning, calendar items, worship logistics —
-- things that don't belong on a parishioner's file and aren't sermon
-- fodder, but that Todd doesn't want to keep dropping on the floor.
--
-- Two tables here:
--
-- 1. worship_admin_items
--    One row per admin note. Sourced from a Daily Capture segment (the
--    common case) OR entered manually inside the Worship Planning app.
--    Carries a status state machine (open → resolved / dismissed) so
--    the review inbox naturally drains.
--
-- 2. worship_admin_item_weeks
--    Join table so a single admin item can attach to zero, one, or
--    several upcoming Sundays. The pastor multi-attaches — there is no
--    first-class concept of a "series" or "group of Sundays" in this
--    phase; if he wants an item to cover Advent, he attaches it to each
--    Advent Sunday individually.
--
-- Both tables are RLS-locked to auth.uid() = owner_user_id, matching the
-- daily_captures posture. Admin items are personal to the pastor for
-- now; visibility for the worship_team role can be added later without
-- a data migration if that becomes desirable.
--
-- Note: worship_plans (the join target) is *staff-shared* rather than
-- owner-scoped, so the join table's RLS enforces access via the parent
-- admin_item's owner_user_id (denormalized onto the join row for a
-- cheap policy check).
-- =====================================================================

-- 1. worship_admin_items ----------------------------------------------

create table if not exists public.worship_admin_items (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  -- One-line summary — becomes the row title in the review inbox and
  -- on WeekCard admin-items panels. Editable by the pastor.
  description text,
  -- The substantive content: verbatim excerpt when sourced from a
  -- Daily Capture segment, or the pastor's own typed body when entered
  -- manually. Not-null so the review UI always has something to render.
  body text not null,
  -- Optional pastor-added notes tacked on later (context, follow-up
  -- status, decisions made). Free-form.
  notes text,

  -- Provenance. If sourced from a Daily Capture segment, both columns
  -- point at the originating rows so the admin item can link back for
  -- context. Both null on manual entry (Worship Planning app add-form).
  --
  -- ON DELETE SET NULL: if the pastor later purges the source capture,
  -- the admin item survives (the excerpt is already copied in `body`);
  -- it just loses the "originally from Daily Capture on X date" link.
  source_capture_id uuid
    references public.daily_captures(id) on delete set null,
  source_segment_id uuid
    references public.daily_capture_segments(id) on delete set null,

  -- Optional: when captured on a specific date (from the source
  -- capture's captured_at, or manually set on the add-form). Null when
  -- the pastor doesn't care.
  captured_at date,

  -- Phase-3 hook: Claude's free-text suggestion of which Sunday(s)
  -- this might belong to, based on any dates or event names in the
  -- excerpt ("VBS in July", "Palm Sunday"). Unused in Phase 1 — the
  -- pastor multi-attaches manually — but declaring the column now so
  -- we don't need another migration when Phase 3 lands.
  suggested_sunday_hint text,

  -- State machine.
  --   'open'      — waiting on attention (default)
  --   'resolved'  — dealt with; keep the record for history
  --   'dismissed' — decided it's not worth acting on
  status text not null default 'open'
    check (status in ('open', 'resolved', 'dismissed')),
  status_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger worship_admin_items_updated_at
  before update on public.worship_admin_items
  for each row execute function set_updated_at();

create index if not exists worship_admin_items_owner_recent_idx
  on public.worship_admin_items (owner_user_id, created_at desc);

-- Inbox surface: unresolved items, cheapest partial index for the
-- Dashboard / /admin-items Inbox tab count.
create index if not exists worship_admin_items_open_idx
  on public.worship_admin_items (owner_user_id)
  where status = 'open';

-- Reverse lookup from source segment (rare but handy for "already saved
-- as admin item" chips on the Daily Capture review screen).
create index if not exists worship_admin_items_source_segment_idx
  on public.worship_admin_items (source_segment_id)
  where source_segment_id is not null;

alter table public.worship_admin_items enable row level security;

create policy "Worship admin items read by owner"
  on public.worship_admin_items for select
  using (auth.uid() = owner_user_id);
create policy "Worship admin items insert by owner"
  on public.worship_admin_items for insert
  with check (auth.uid() = owner_user_id);
create policy "Worship admin items update by owner"
  on public.worship_admin_items for update
  using (auth.uid() = owner_user_id);
create policy "Worship admin items delete by owner"
  on public.worship_admin_items for delete
  using (auth.uid() = owner_user_id);

-- 2. worship_admin_item_weeks -----------------------------------------

create table if not exists public.worship_admin_item_weeks (
  id uuid primary key default gen_random_uuid(),
  admin_item_id uuid not null
    references public.worship_admin_items(id) on delete cascade,
  worship_plan_id uuid not null
    references public.worship_plans(id) on delete cascade,
  -- Denormalized owner for a cheap RLS policy — see file header. Kept
  -- in sync at insert time (client sets it; also enforceable via
  -- trigger if we ever need it).
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  created_at timestamptz not null default now(),

  -- Prevent duplicate attachments of the same item to the same Sunday.
  unique (admin_item_id, worship_plan_id)
);

create index if not exists worship_admin_item_weeks_item_idx
  on public.worship_admin_item_weeks (admin_item_id);
-- Forward lookup: "what admin items are attached to this Sunday?" —
-- the WeekCard panel's primary query.
create index if not exists worship_admin_item_weeks_plan_idx
  on public.worship_admin_item_weeks (worship_plan_id);

alter table public.worship_admin_item_weeks enable row level security;

-- The join row is only visible/mutable to the owner of the parent
-- admin item. Denormalizing owner_user_id keeps this check to a
-- single column comparison rather than a subquery.
create policy "Worship admin item weeks read by owner"
  on public.worship_admin_item_weeks for select
  using (auth.uid() = owner_user_id);
create policy "Worship admin item weeks insert by owner"
  on public.worship_admin_item_weeks for insert
  with check (
    auth.uid() = owner_user_id
    and exists (
      select 1 from public.worship_admin_items ai
       where ai.id = admin_item_id
         and ai.owner_user_id = auth.uid()
    )
  );
create policy "Worship admin item weeks delete by owner"
  on public.worship_admin_item_weeks for delete
  using (auth.uid() = owner_user_id);
-- No update policy — join rows are immutable; attach/detach is
-- insert/delete rather than update.

-- =====================================================================
-- Worship Planning foundation
--
-- Phase 1 of the Worship Planning app. Adds:
--
--   * 'worship_team' role on staff_profiles — voting members for
--     scripture / theme decisions, but no broader admin access.
--
--   * Extends the existing worship_plans table with the columns the
--     planning workflow needs (text source, lectionary year/designation,
--     liturgical season, link back to the chosen planning_options row).
--
--   * planning_options — every candidate text under consideration for
--     a Sunday. Sourced from RCL (4 readings per Sunday) or written
--     in by the pastor as off-lectionary.
--
--   * planning_votes — open thumbs-up votes by team members on
--     candidate options. Pastor sees the tally and makes the final
--     selection (the vote is advisory).
--
-- The pastor has special powers expressed at the app layer (workflow
-- state transitions). RLS just confirms staff-only read/write.
-- =====================================================================

-- 1. Add 'worship_team' to allowed staff roles.
alter table public.staff_profiles
  drop constraint if exists staff_profiles_role_check;

alter table public.staff_profiles
  add constraint staff_profiles_role_check
  check (role in (
    'pastor',
    'music_director',
    'pianist',
    'office_admin',
    'treasurer',
    'social_media',
    'worship_team',
    'staff'
  ));

-- 2. Extend worship_plans with the planning workflow's metadata.
alter table public.worship_plans
  -- 'rcl' (one of the lectionary readings) | 'off_lectionary' (write-in) | null (undecided)
  add column if not exists text_source text
    check (text_source in ('rcl', 'off_lectionary')),
  -- 'A' | 'B' | 'C' — which RCL year this Sunday belongs to. Useful
  -- as cached metadata so we don't re-derive from the date everywhere.
  add column if not exists lectionary_year text
    check (lectionary_year in ('A', 'B', 'C')),
  -- The lectionary's name for the day, e.g. 'Easter 5', 'Proper 12',
  -- 'Christ the King', 'Christmas Eve'. Free-form so it can hold
  -- non-RCL designations too ('Homecoming Sunday', 'Heritage Sunday').
  add column if not exists lectionary_designation text,
  -- Which season this Sunday falls in: 'advent', 'christmas',
  -- 'epiphany', 'lent', 'easter', 'pentecost', 'ordinary', or 'special'.
  -- Drives season-level theme grouping (phase 2).
  add column if not exists liturgical_season text,
  -- FK to the planning_options row that was selected for this Sunday.
  -- Null when text_source = 'off_lectionary' (the text lives directly
  -- on scripture_reference) or when nothing's been decided yet.
  add column if not exists selected_text_option_id uuid;

-- planning_options is created next; add the FK after.

-- 3. Per-Sunday candidate texts (RCL + off-lectionary write-ins).
create table if not exists public.planning_options (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  -- 'rcl' = pulled from the RCL data file; 'manual' = pastor write-in.
  source text not null check (source in ('rcl', 'manual')),
  -- 'ot' | 'psalm' | 'epistle' | 'gospel' | 'other'
  reading_kind text not null
    check (reading_kind in ('ot', 'psalm', 'epistle', 'gospel', 'other')),
  -- Short label shown in the UI (e.g., 'Acts 7:55-60' or 'Psalm 23').
  -- For 'other', this is whatever the pastor typed.
  reference text not null,
  -- Optional human-readable label; e.g., when the pastor adds an
  -- "off-lectionary" text they might note "for Mother's Day".
  label text,
  created_at timestamptz not null default now()
);

create index if not exists planning_options_service_date_idx
  on public.planning_options (service_date);
-- One option per (service_date, reference) so re-running RCL seeding
-- is idempotent.
create unique index if not exists planning_options_dedupe_uniq
  on public.planning_options (service_date, lower(reference));

alter table public.planning_options enable row level security;

create policy "Staff can read planning_options"
  on public.planning_options for select
  using (is_staff());
create policy "Staff can write planning_options"
  on public.planning_options for all
  using (is_staff()) with check (is_staff());

-- Hook the FK on worship_plans now that the target table exists.
alter table public.worship_plans
  add constraint worship_plans_selected_option_fk
    foreign key (selected_text_option_id)
    references public.planning_options(id) on delete set null;

-- 4. Open thumbs-up votes on options.
create table if not exists public.planning_votes (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references public.planning_options(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- One vote per (option, user) — clicking again removes the vote.
  unique (option_id, user_id)
);

create index if not exists planning_votes_option_idx
  on public.planning_votes (option_id);

alter table public.planning_votes enable row level security;

-- Read: any staff can see the tally.
create policy "Staff can read planning_votes"
  on public.planning_votes for select
  using (is_staff());

-- Insert: the user can only insert THEIR OWN vote. Voting eligibility
-- (which roles can vote) is enforced at the app layer for now — every
-- staff member technically COULD insert, but the UI only shows the
-- button to the right roles.
create policy "Staff can vote as themselves"
  on public.planning_votes for insert
  with check (is_staff() and auth.uid() = user_id);

-- Delete: only the user who voted can remove their own vote.
create policy "Staff can unvote themselves"
  on public.planning_votes for delete
  using (auth.uid() = user_id);

-- =====================================================================
-- A small helper to compute the RCL year (A/B/C) for any service_date.
-- The lectionary year changes on the First Sunday of Advent (~late Nov
-- or early Dec). Useful for backfilling lectionary_year on existing
-- worship_plans rows or sanity-checking the JSON we ship.
--
-- Reference points (verified):
--   Advent 1 of Year A starts: Nov 30 2025 → Year A through Nov 21 2026
--   Wait — that's wrong. Let me re-check:
--   Advent 1 2025 is Nov 30 2025 → that begins Year C (because the
--   civil-year shift always advances). Hmm, this is exactly the kind
--   of thing the helper should encode rather than relying on memory.
--
-- The rule: liturgical year starts the first Sunday of Advent (the
-- 4th Sunday before Dec 25 inclusive). Year cycles A→B→C; we anchor
-- on a known correct (date, year) pair and increment from there.
--
-- Anchor: Advent 1 2022 = Nov 27 2022 = start of Year A. From there:
--   Year A: 2022-11-27 → 2023-12-02
--   Year B: 2023-12-03 → 2024-11-30
--   Year C: 2024-12-01 → 2025-11-29
--   Year A: 2025-11-30 → 2026-11-28
--   Year B: 2026-11-29 → 2027-11-27
--   Year C: 2027-11-28 → 2028-12-02
-- =====================================================================
create or replace function public.rcl_year_for_date(p_date date)
returns text
language plpgsql
immutable
as $$
declare
  -- First Sunday of Advent for the prior civil year, used to anchor.
  advent1_year int;
  advent1_date date;
  cycle_index int;
begin
  -- Compute Advent 1 of the civil year that "owns" p_date in lectionary
  -- terms. If p_date is on/after Advent 1 of its own year, that's the
  -- year. Otherwise, it belongs to the prior year's cycle.
  advent1_date := public.advent1_of(extract(year from p_date)::int);
  if p_date < advent1_date then
    advent1_year := extract(year from p_date)::int - 1;
  else
    advent1_year := extract(year from p_date)::int;
  end if;
  -- Year A anchor: Advent 1 2022 (Nov 27 2022). Cycle = (year - 2022) mod 3.
  cycle_index := (advent1_year - 2022) % 3;
  if cycle_index < 0 then cycle_index := cycle_index + 3; end if;
  return case cycle_index when 0 then 'A' when 1 then 'B' else 'C' end;
end;
$$;

-- Compute Advent 1 of a given civil year (4th Sunday before Dec 25).
create or replace function public.advent1_of(p_year int)
returns date
language plpgsql
immutable
as $$
declare
  christmas_date date := make_date(p_year, 12, 25);
  -- DOW: 0=Sunday in extract(dow). We want the Sunday on/before Dec 25,
  -- then back up 3 more Sundays (so 4 Sundays total before Christmas
  -- inclusive of Advent 4).
  sunday_on_or_before_xmas date;
  dow int;
begin
  dow := extract(dow from christmas_date)::int;
  -- If Christmas IS Sunday, advent 4 = the Sunday before (Dec 18) —
  -- so we still subtract 7. That means: nearest Sunday on or before
  -- Dec 24 (not 25). Subtract dow when dow > 0; subtract 7 when dow = 0.
  if dow = 0 then
    sunday_on_or_before_xmas := christmas_date - 7;
  else
    sunday_on_or_before_xmas := christmas_date - dow;
  end if;
  -- Back up 3 more Sundays to land on Advent 1.
  return sunday_on_or_before_xmas - 21;
end;
$$;

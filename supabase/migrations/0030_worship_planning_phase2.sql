-- =====================================================================
-- Worship Planning — Phase 2
--
-- Adds:
--   * special_services       — ad-hoc non-Sunday services (Ash Wed,
--                              Christmas Eve, funerals, weddings, etc.)
--                              Lightweight services skip the voting
--                              workflow; planning services use the same
--                              planning_options / planning_votes pipeline
--                              as Sundays.
--
--   * worship_groupings      — buckets that tie multiple service_dates
--                              together for shared theming. Two kinds:
--                              'season' (auto, one per liturgical season
--                              with at least one upcoming service) and
--                              'custom' (pastor-made — e.g., a 3-week
--                              stewardship arc, a Lenten series).
--
--   * worship_grouping_dates — link table: grouping ↔ service_date(s).
--
--   * theme_options          — proposed themes attached to a grouping.
--                              Suggest / vote / select, mirroring how
--                              scripture options work for a single week.
--
--   * theme_votes            — open thumbs-up votes on theme options.
--
--   * worship_elements       — reusable liturgy / hymn library. Liturgy
--                              blocks (call-to-worship, prayers, etc.)
--                              and tagged hymn picks. Tagged by season,
--                              theme, scripture; can be dropped into any
--                              week.
--
--   * week_elements          — link table: service_date ↔ saved element.
--                              Pastor can override title/body per use.
--
--   * element_suggestions    — Phase-4 preview queue. Worship team can
--                              suggest an element ("let's sing X" /
--                              "try a candle moment") that the pastor
--                              reviews and either accepts (optionally
--                              saving as a reusable element) or declines.
--
-- All RLS: staff read + write; votes restricted to the casting user.
-- =====================================================================

-- =====================================================================
-- 1. special_services
-- =====================================================================
create table if not exists public.special_services (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  -- 'planning'    — full workflow: voting, themes, scripture pick, can
  --                 attach worship elements. Use for liturgical specials
  --                 the whole team is planning together (Ash Wed, Maundy
  --                 Thu, Christmas Eve, Easter Vigil).
  -- 'lightweight' — just a calendar record. Use for funerals, weddings,
  --                 graveside services, ad-hoc prayer services. Pastor
  --                 can attach scripture + notes; no voting, no theme.
  workflow_kind text not null check (workflow_kind in ('planning', 'lightweight')),
  -- Free-form kind label so the UI can show an icon / category.
  -- Suggested values (UI picks from these but stores the string):
  --   'ash_wednesday', 'maundy_thursday', 'good_friday', 'easter_vigil',
  --   'christmas_eve', 'christmas_day', 'watchnight', 'all_saints',
  --   'funeral', 'wedding', 'memorial', 'prayer_service', 'baptism',
  --   'community_service', 'other'
  service_kind text not null,
  title text not null,        -- 'Ash Wednesday Service', 'Funeral for Jane Doe'
  time_of_day text,           -- '7:00 PM', '11:00 AM' — free text
  location text,              -- 'Sanctuary', 'Fellowship Hall', 'Graveside'
  notes text,                 -- pastor notes
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger special_services_updated_at before update on public.special_services
  for each row execute function set_updated_at();

create index if not exists special_services_date_idx
  on public.special_services (service_date);

alter table public.special_services enable row level security;

create policy "Staff can read special_services"
  on public.special_services for select
  using (is_staff());
create policy "Staff can write special_services"
  on public.special_services for all
  using (is_staff()) with check (is_staff());

-- =====================================================================
-- 2. worship_groupings
-- =====================================================================
create table if not exists public.worship_groupings (
  id uuid primary key default gen_random_uuid(),
  name text not null,                 -- 'Stewardship 2026', 'Advent: Light in the Darkness'
  description text,
  -- 'season' — automatic, one per liturgical season. The 'season'
  --            column holds 'advent' | 'christmas' | 'lent' | etc.
  -- 'custom' — pastor-defined arbitrary grouping. 'season' is null.
  grouping_kind text not null check (grouping_kind in ('season', 'custom')),
  season text,                        -- advent | christmas | epiphany | lent | easter | pentecost | ordinary
  -- Once the suggest/vote/select cycle finishes, the chosen theme lives here.
  selected_theme_option_id uuid,      -- FK added after theme_options exists
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger worship_groupings_updated_at before update on public.worship_groupings
  for each row execute function set_updated_at();

-- Only one 'season' grouping per (season, lectionary_year) effectively —
-- but we don't track lectionary_year here, so just dedupe on name.
-- The app layer ensures uniqueness when auto-creating season groupings.
create unique index if not exists worship_groupings_name_uniq
  on public.worship_groupings (lower(name));

alter table public.worship_groupings enable row level security;

create policy "Staff can read worship_groupings"
  on public.worship_groupings for select
  using (is_staff());
create policy "Staff can write worship_groupings"
  on public.worship_groupings for all
  using (is_staff()) with check (is_staff());

-- =====================================================================
-- 3. worship_grouping_dates — which service_dates belong to which groupings
-- =====================================================================
create table if not exists public.worship_grouping_dates (
  grouping_id uuid not null references public.worship_groupings(id) on delete cascade,
  service_date date not null,
  added_at timestamptz not null default now(),
  primary key (grouping_id, service_date)
);

create index if not exists worship_grouping_dates_date_idx
  on public.worship_grouping_dates (service_date);

alter table public.worship_grouping_dates enable row level security;

create policy "Staff can read worship_grouping_dates"
  on public.worship_grouping_dates for select
  using (is_staff());
create policy "Staff can write worship_grouping_dates"
  on public.worship_grouping_dates for all
  using (is_staff()) with check (is_staff());

-- =====================================================================
-- 4. theme_options + theme_votes
-- =====================================================================
create table if not exists public.theme_options (
  id uuid primary key default gen_random_uuid(),
  grouping_id uuid not null references public.worship_groupings(id) on delete cascade,
  title text not null,                -- 'Living Hope'
  description text,                   -- 'How resurrection shapes daily life'
  scripture_anchor text,              -- '1 Peter 1:3-9' (optional)
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists theme_options_grouping_idx
  on public.theme_options (grouping_id);

alter table public.theme_options enable row level security;

create policy "Staff can read theme_options"
  on public.theme_options for select
  using (is_staff());
create policy "Staff can write theme_options"
  on public.theme_options for all
  using (is_staff()) with check (is_staff());

-- Hook the FK on worship_groupings now that the target exists.
alter table public.worship_groupings
  add constraint worship_groupings_selected_theme_fk
    foreign key (selected_theme_option_id)
    references public.theme_options(id) on delete set null;

create table if not exists public.theme_votes (
  id uuid primary key default gen_random_uuid(),
  theme_option_id uuid not null references public.theme_options(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (theme_option_id, user_id)
);

create index if not exists theme_votes_option_idx
  on public.theme_votes (theme_option_id);

alter table public.theme_votes enable row level security;

create policy "Staff can read theme_votes"
  on public.theme_votes for select
  using (is_staff());
create policy "Staff can vote themes as themselves"
  on public.theme_votes for insert
  with check (is_staff() and auth.uid() = user_id);
create policy "Staff can unvote themes themselves"
  on public.theme_votes for delete
  using (auth.uid() = user_id);

-- =====================================================================
-- 5. worship_elements — reusable liturgy / hymn library
-- =====================================================================
create table if not exists public.worship_elements (
  id uuid primary key default gen_random_uuid(),
  -- 'liturgy' = a text block (CTA, prayer, responsive reading, etc.)
  -- 'hymn'    = a hymn pick (hymnal + number, with optional notes)
  element_kind text not null check (element_kind in ('liturgy', 'hymn')),
  -- For liturgy: 'call_to_worship' | 'opening_prayer' | 'pastoral_prayer'
  --              | 'confession' | 'assurance' | 'responsive_reading'
  --              | 'offering_prayer' | 'communion' | 'benediction' | 'other'
  -- For hymn:    optional placement hint — 'opening' | 'sermon_response'
  --              | 'closing' | 'communion' | 'offering' | null
  subtype text,
  title text not null,                -- 'Call to Worship for Easter'
  body text,                          -- the actual liturgical text
  -- Hymn-specific
  hymnal text,                        -- 'UMH', 'TFWS', 'WS', 'AAHH'
  hymn_number text,                   -- '102'
  -- Tagging — multi-valued so an element can fit multiple seasons/themes
  seasons text[] default '{}',        -- ['easter','pentecost']
  tags text[] default '{}',           -- ['communion','confession','stewardship']
  scripture_refs text[] default '{}', -- ['John 14:1-6','Psalm 23']
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger worship_elements_updated_at before update on public.worship_elements
  for each row execute function set_updated_at();

create index if not exists worship_elements_kind_idx
  on public.worship_elements (element_kind);
create index if not exists worship_elements_seasons_idx
  on public.worship_elements using gin (seasons);
create index if not exists worship_elements_tags_idx
  on public.worship_elements using gin (tags);

alter table public.worship_elements enable row level security;

create policy "Staff can read worship_elements"
  on public.worship_elements for select
  using (is_staff());
create policy "Staff can write worship_elements"
  on public.worship_elements for all
  using (is_staff()) with check (is_staff());

-- =====================================================================
-- 6. week_elements — drop a saved element into a specific service date
-- =====================================================================
create table if not exists public.week_elements (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  element_id uuid not null references public.worship_elements(id) on delete cascade,
  position int not null default 0,
  -- Per-use overrides. Null = use the saved element's value as-is.
  override_title text,
  override_body text,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists week_elements_date_idx
  on public.week_elements (service_date);
create index if not exists week_elements_element_idx
  on public.week_elements (element_id);

alter table public.week_elements enable row level security;

create policy "Staff can read week_elements"
  on public.week_elements for select
  using (is_staff());
create policy "Staff can write week_elements"
  on public.week_elements for all
  using (is_staff()) with check (is_staff());

-- =====================================================================
-- 7. element_suggestions — Phase 4 preview queue
-- =====================================================================
create table if not exists public.element_suggestions (
  id uuid primary key default gen_random_uuid(),
  service_date date,                  -- null = general / any-week suggestion
  suggestion_kind text not null
    check (suggestion_kind in ('hymn', 'liturgy', 'special_music', 'other')),
  title text not null,                -- 'Christ the Lord Is Risen Today'
  body text,                          -- description / detail / why
  hymnal text,                        -- if it's a hymn suggestion
  hymn_number text,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'archived')),
  -- When accepted, optionally link to the worship_element that was
  -- created/used as a result. Null if the pastor accepted without
  -- saving as a reusable element.
  accepted_element_id uuid references public.worship_elements(id) on delete set null,
  suggested_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger element_suggestions_updated_at before update on public.element_suggestions
  for each row execute function set_updated_at();

create index if not exists element_suggestions_status_idx
  on public.element_suggestions (status);
create index if not exists element_suggestions_date_idx
  on public.element_suggestions (service_date);

alter table public.element_suggestions enable row level security;

create policy "Staff can read element_suggestions"
  on public.element_suggestions for select
  using (is_staff());
-- Anyone on staff can suggest, but the suggester must be themselves.
create policy "Staff can suggest as themselves"
  on public.element_suggestions for insert
  with check (is_staff() and (suggested_by is null or auth.uid() = suggested_by));
-- Updates (status change, review notes) are staff-only via app permissions.
create policy "Staff can update element_suggestions"
  on public.element_suggestions for update
  using (is_staff()) with check (is_staff());
-- Delete: only the suggester (or app-layer pastor) can clear.
create policy "Staff can delete element_suggestions"
  on public.element_suggestions for delete
  using (is_staff());

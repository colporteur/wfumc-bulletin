-- =====================================================================
-- Sermon Liturgies — text-based liturgies linked to sermons
--
-- Pastor Todd has many years of liturgies stored as Evernote notes,
-- many of which match up with specific sermons (by title, scripture,
-- or both). This system stores them, parses them into discrete
-- sections via Claude, and links them to one or more sermons.
--
-- Many-to-one (or many-to-many) is the rule, not the exception:
-- the same sermon may have been preached at Grace, Epworth, and
-- Wedowee with three different liturgies; one liturgy may pair with
-- two related sermons.
--
-- Three tables:
--
--   sermon_liturgies         — top-level liturgy: title, raw body,
--                              import metadata, optional usage info
--                              (date / location). Owned by one user.
--
--   sermon_liturgy_sections  — Claude-parsed sections of a liturgy:
--                              call-to-worship, opening prayer,
--                              scripture reading, sermon, pastoral
--                              prayer, announcements, benediction, etc.
--                              Each section has its own type / title /
--                              body / sort_order. Announcements get
--                              flagged so the display can hide them
--                              by default (the pastor doesn't want
--                              old announcements re-surfacing as
--                              reusable content).
--
--   sermon_liturgy_links     — many-to-many between liturgies and
--                              sermons. Records HOW the link was
--                              created (manual, title_match,
--                              scripture_match) and confidence
--                              (high/medium/low). The auto-import
--                              flow inserts high-confidence links as
--                              approved=true and lower-confidence
--                              ones as approved=false (pending review).
-- =====================================================================

-- 1. sermon_liturgies (top-level)
create table if not exists public.sermon_liturgies (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  -- The full liturgy body as imported. Source of truth in case the
  -- Claude-parsed sections get something wrong; the pastor can re-parse.
  raw_body text,
  -- Optional usage metadata — when/where this liturgy was used.
  used_at date,
  used_location text,
  -- Free-form scripture refs noted on the liturgy itself (often in the
  -- Evernote title). Matched against sermon scripture during auto-link.
  scripture_refs text,
  -- Pastor's private notes about the liturgy.
  notes text,
  -- Import metadata — same pattern as the resources import (0021).
  external_source text,
  external_guid text,
  original_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger sermon_liturgies_updated_at
  before update on public.sermon_liturgies
  for each row execute function set_updated_at();

create index if not exists sermon_liturgies_owner_idx
  on public.sermon_liturgies (owner_user_id);
create unique index if not exists sermon_liturgies_external_dedupe_uniq
  on public.sermon_liturgies (owner_user_id, external_source, external_guid)
  where external_guid is not null;

alter table public.sermon_liturgies enable row level security;

create policy "Liturgy read by owner or staff"
  on public.sermon_liturgies for select
  using (auth.uid() = owner_user_id or is_staff());
create policy "Liturgy insert by owner or staff"
  on public.sermon_liturgies for insert
  with check (auth.uid() = owner_user_id or is_staff());
create policy "Liturgy update by owner or staff"
  on public.sermon_liturgies for update
  using (auth.uid() = owner_user_id or is_staff());
create policy "Liturgy delete by owner or staff"
  on public.sermon_liturgies for delete
  using (auth.uid() = owner_user_id or is_staff());

-- 2. sermon_liturgy_sections (parsed sections)
create table if not exists public.sermon_liturgy_sections (
  id uuid primary key default gen_random_uuid(),
  liturgy_id uuid not null references public.sermon_liturgies(id) on delete cascade,
  -- Denormalized owner for cheap RLS (matches parent liturgy).
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  -- Categorized section kind. Free-form because liturgies vary widely;
  -- common values: 'call_to_worship', 'opening_prayer',
  -- 'pastoral_prayer', 'confession', 'assurance',
  -- 'responsive_reading', 'scripture', 'sermon', 'hymn',
  -- 'offering_prayer', 'communion', 'announcements', 'benediction',
  -- 'other'.
  section_kind text not null default 'other',
  title text,
  body text not null,
  sort_order int not null default 0,
  -- Hide announcements from default display (per Todd's request:
  -- old announcements aren't relevant going forward).
  is_announcement boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists sermon_liturgy_sections_liturgy_idx
  on public.sermon_liturgy_sections (liturgy_id, sort_order);
create index if not exists sermon_liturgy_sections_owner_idx
  on public.sermon_liturgy_sections (owner_user_id);

alter table public.sermon_liturgy_sections enable row level security;

create policy "Section read by parent visibility"
  on public.sermon_liturgy_sections for select
  using (auth.uid() = owner_user_id or is_staff());
create policy "Section insert by parent owner"
  on public.sermon_liturgy_sections for insert
  with check (auth.uid() = owner_user_id or is_staff());
create policy "Section update by parent owner"
  on public.sermon_liturgy_sections for update
  using (auth.uid() = owner_user_id or is_staff());
create policy "Section delete by parent owner"
  on public.sermon_liturgy_sections for delete
  using (auth.uid() = owner_user_id or is_staff());

-- 3. sermon_liturgy_links (many-to-many)
create table if not exists public.sermon_liturgy_links (
  id uuid primary key default gen_random_uuid(),
  liturgy_id uuid not null references public.sermon_liturgies(id) on delete cascade,
  sermon_id uuid not null references public.sermons(id) on delete cascade,
  -- Denormalized owner so RLS doesn't have to JOIN to enforce.
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  -- How the link was created.
  link_kind text not null default 'manual'
    check (link_kind in ('manual', 'title_match', 'scripture_match', 'date_match')),
  -- Confidence — used in the review inbox to triage.
  confidence text not null default 'high'
    check (confidence in ('high', 'medium', 'low')),
  -- True for high-confidence auto-links and any manual link. False for
  -- queued auto-suggestions awaiting pastor review.
  approved boolean not null default true,
  created_at timestamptz not null default now(),
  unique (liturgy_id, sermon_id)
);

create index if not exists sermon_liturgy_links_liturgy_idx
  on public.sermon_liturgy_links (liturgy_id);
create index if not exists sermon_liturgy_links_sermon_idx
  on public.sermon_liturgy_links (sermon_id);
create index if not exists sermon_liturgy_links_pending_idx
  on public.sermon_liturgy_links (owner_user_id, approved)
  where approved = false;

alter table public.sermon_liturgy_links enable row level security;

create policy "Liturgy link read by owner or staff"
  on public.sermon_liturgy_links for select
  using (auth.uid() = owner_user_id or is_staff());
create policy "Liturgy link insert by owner or staff"
  on public.sermon_liturgy_links for insert
  with check (auth.uid() = owner_user_id or is_staff());
create policy "Liturgy link update by owner or staff"
  on public.sermon_liturgy_links for update
  using (auth.uid() = owner_user_id or is_staff());
create policy "Liturgy link delete by owner or staff"
  on public.sermon_liturgy_links for delete
  using (auth.uid() = owner_user_id or is_staff());

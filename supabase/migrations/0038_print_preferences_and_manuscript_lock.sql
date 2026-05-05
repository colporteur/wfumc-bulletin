-- =====================================================================
-- Print preferences + manuscript lock
--
-- Two related additions for the Sermon Workspace feature:
--
-- 1. print_preferences  — one row per user. Holds the formatting
--                         defaults the docx + pptx exporters apply
--                         when generating a manuscript or deck.
--                         Per-sermon overrides happen in a small
--                         modal at export time; this is the global
--                         default.
--
-- 2. sermons.manuscript_locked / manuscript_locked_at
--                       — flags that the workspace UI watches to
--                         freeze the chat panel and present an
--                         "Unlock to revise" button. Locking writes
--                         a sermon_revisions snapshot first
--                         (manuscript_locked_revision_id points at it)
--                         so the moment-of-preaching version is
--                         permanently retrievable even if the
--                         pastor unlocks and revises later.
--
-- Defaults aim at a paper-friendly pulpit manuscript: 14pt, 1.5
-- spacing, generous margins, page numbers bottom-right. The pastor
-- can change everything from the settings page.
-- =====================================================================

-- 1. print_preferences (one per user)
create table if not exists public.print_preferences (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  -- Typography
  font_family text not null default 'Cambria',
  font_size_pt int not null default 14 check (font_size_pt between 8 and 36),
  line_spacing numeric(3,2) not null default 1.5
    check (line_spacing between 1.0 and 3.0),

  -- Margins (inches)
  margin_top_in numeric(3,2) not null default 1.0
    check (margin_top_in between 0.25 and 3.0),
  margin_bottom_in numeric(3,2) not null default 1.0
    check (margin_bottom_in between 0.25 and 3.0),
  margin_left_in numeric(3,2) not null default 1.25
    check (margin_left_in between 0.25 and 3.0),
  margin_right_in numeric(3,2) not null default 1.25
    check (margin_right_in between 0.25 and 3.0),

  -- Page numbers
  page_number_position text not null default 'bottom_right'
    check (page_number_position in (
      'none',
      'bottom_left', 'bottom_center', 'bottom_right',
      'top_left',    'top_center',    'top_right'
    )),

  -- Header content. Free-form text with token substitution at
  -- export time: {title}, {scripture}, {date}, {page}.
  -- Empty string means no header.
  header_content text not null default '',

  -- Whether to render the scripture reference under the title.
  show_scripture_reference boolean not null default true,

  -- How scripture passages quoted in the body get formatted.
  --   inline       — same flow as body
  --   block_indent — indented block, no italic
  --   italic       — italic, same flow as body
  scripture_format text not null default 'block_indent'
    check (scripture_format in ('inline', 'block_indent', 'italic')),

  -- If true, the exporter inserts a page break before each H1/H2-style
  -- section in the manuscript. Off by default (most pastors prefer
  -- continuous flow for paper preaching).
  page_break_between_sections boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One prefs row per user. Upserts are simple this way.
  unique (owner_user_id)
);

create trigger print_preferences_updated_at
  before update on public.print_preferences
  for each row execute function set_updated_at();

alter table public.print_preferences enable row level security;

create policy "Print prefs read by owner or staff"
  on public.print_preferences for select
  using (auth.uid() = owner_user_id or is_staff());
create policy "Print prefs insert by owner or staff"
  on public.print_preferences for insert
  with check (auth.uid() = owner_user_id or is_staff());
create policy "Print prefs update by owner or staff"
  on public.print_preferences for update
  using (auth.uid() = owner_user_id or is_staff());
create policy "Print prefs delete by owner or staff"
  on public.print_preferences for delete
  using (auth.uid() = owner_user_id or is_staff());

-- 2. Manuscript lock columns on sermons
alter table public.sermons
  add column if not exists manuscript_locked boolean not null default false,
  add column if not exists manuscript_locked_at timestamptz,
  add column if not exists manuscript_locked_revision_id uuid
    references public.sermon_revisions(id) on delete set null;

-- Cheap partial index to find currently-locked sermons (small subset).
create index if not exists sermons_locked_idx
  on public.sermons (owner_user_id, manuscript_locked_at desc)
  where manuscript_locked = true;

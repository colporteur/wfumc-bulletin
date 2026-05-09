-- =====================================================================
-- Pastor's Liturgy Sheet support
--
-- Two related additions for the "Pastor's Liturgy Sheet" feature:
--
-- 1. liturgy_items.pastor_print_include
--      Per-item flag: should this item appear in the pastor's
--      printed liturgy sheet for the service? Defaults to false so
--      existing items don't suddenly explode the printout. The
--      bulletin app's "create new bulletin" flow already copies all
--      liturgy_items columns from the previous bulletin via spread, so
--      pastor selections naturally roll forward week-to-week without
--      any extra plumbing.
--
-- 2. pastor_liturgy_print_preferences (one row per user)
--      Style + page layout preferences for the Word doc the exporter
--      generates. Intentionally simpler than the sermon
--      print_preferences table — no scripture-formatting choices, no
--      page-break-between-sections, etc. This sheet is one-off and
--      utilitarian.
-- =====================================================================

-- 1. Per-item flag.
alter table public.liturgy_items
  add column if not exists pastor_print_include boolean not null default false;

-- A small partial index speeds up the exporter's "fetch only items I
-- want" query, which is the only place this column is filtered on.
create index if not exists liturgy_items_pastor_print_include_idx
  on public.liturgy_items (bulletin_id)
  where pastor_print_include = true;

-- 2. Per-user print preferences for the pastor liturgy sheet.
create table if not exists public.pastor_liturgy_print_preferences (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  -- Typography
  font_family text not null default 'Cambria',
  font_size_pt int not null default 12 check (font_size_pt between 8 and 36),
  line_spacing numeric(3,2) not null default 1.15
    check (line_spacing between 1.0 and 3.0),

  -- Margins (inches)
  margin_top_in numeric(3,2) not null default 0.75
    check (margin_top_in between 0.25 and 3.0),
  margin_bottom_in numeric(3,2) not null default 0.75
    check (margin_bottom_in between 0.25 and 3.0),
  margin_left_in numeric(3,2) not null default 0.75
    check (margin_left_in between 0.25 and 3.0),
  margin_right_in numeric(3,2) not null default 0.75
    check (margin_right_in between 0.25 and 3.0),

  -- Page numbers (off / which corner).
  page_number_position text not null default 'bottom_right'
    check (page_number_position in (
      'none',
      'bottom_left', 'bottom_center', 'bottom_right',
      'top_left',    'top_center',    'top_right'
    )),

  -- Header / footer text. Token substitution at export time:
  --   {date}, {sunday}, {church}, {page}
  -- Empty string means no header / footer.
  header_content text not null default '{church} — {sunday} {date}',
  footer_content text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (owner_user_id)
);

create trigger pastor_liturgy_print_preferences_updated_at
  before update on public.pastor_liturgy_print_preferences
  for each row execute function set_updated_at();

alter table public.pastor_liturgy_print_preferences enable row level security;

create policy "Pastor liturgy prefs read by owner or staff"
  on public.pastor_liturgy_print_preferences for select
  using (auth.uid() = owner_user_id or is_staff());
create policy "Pastor liturgy prefs insert by owner or staff"
  on public.pastor_liturgy_print_preferences for insert
  with check (auth.uid() = owner_user_id or is_staff());
create policy "Pastor liturgy prefs update by owner or staff"
  on public.pastor_liturgy_print_preferences for update
  using (auth.uid() = owner_user_id or is_staff());
create policy "Pastor liturgy prefs delete by owner or staff"
  on public.pastor_liturgy_print_preferences for delete
  using (auth.uid() = owner_user_id or is_staff());

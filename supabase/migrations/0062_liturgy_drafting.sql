-- =====================================================================
-- Liturgy drafting — per-element-type Claude instructions + cached
-- spoiler-safe sermon theme.
--
-- Adds:
--   1. liturgy_element_instructions  — per-user, per-element-type
--      persistent guidance that gets prepended to every Claude
--      drafting / brainstorming request for that element type.
--      One row per (user, element_type). UPSERT pattern.
--
--   2. sermons.liturgy_theme  — lazily-cached one-paragraph theme
--      summary, deliberately spoiler-safe (no illustrations or stories
--      from the manuscript). Generated on first liturgy-drafting
--      click for a given sermon and reused thereafter.
-- =====================================================================

-- 1. liturgy_element_instructions
create table if not exists public.liturgy_element_instructions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  -- Canonical element-type key (e.g., 'call_to_worship',
  -- 'congregational_prayer', 'offering_statement'). Same vocabulary as
  -- sermon_liturgy_sections.section_kind.
  element_type text not null,
  -- Free-form pastor guidance. Becomes part of the system prompt when
  -- drafting / brainstorming this element type.
  instructions text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, element_type)
);

create trigger liturgy_element_instructions_updated_at
  before update on public.liturgy_element_instructions
  for each row execute function set_updated_at();

create index if not exists liturgy_element_instructions_owner_idx
  on public.liturgy_element_instructions (owner_user_id);

alter table public.liturgy_element_instructions enable row level security;

create policy "Instructions read by owner"
  on public.liturgy_element_instructions for select
  using (auth.uid() = owner_user_id);
create policy "Instructions insert by owner"
  on public.liturgy_element_instructions for insert
  with check (auth.uid() = owner_user_id);
create policy "Instructions update by owner"
  on public.liturgy_element_instructions for update
  using (auth.uid() = owner_user_id);
create policy "Instructions delete by owner"
  on public.liturgy_element_instructions for delete
  using (auth.uid() = owner_user_id);

-- 2. sermons.liturgy_theme — lazy spoiler-safe theme cache
alter table public.sermons
  add column if not exists liturgy_theme text;

comment on column public.sermons.liturgy_theme is
  'Lazily-generated spoiler-safe theme summary of the manuscript, used by liturgy-drafting helpers. Regenerate by clearing to NULL.';

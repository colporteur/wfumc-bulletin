-- =====================================================================
-- hymn_cache — remember hymnal photos so we only analyze once per hymn.
--
-- After a successful Claude-vision analysis of a hymnal page, store
-- the parsed title/tune/bio/lyrics keyed on (hymnal_source, hymn_number).
-- The next time anyone enters that same hymnal + number on a hymn item,
-- the fields auto-fill from this cache without a fresh photo.
--
-- Staff-only RLS — worshippers don't query this; they get the lyrics
-- via liturgy_items.expanded_detail like before.
-- =====================================================================

create table public.hymn_cache (
  id uuid primary key default gen_random_uuid(),
  hymnal_source text not null,
  hymn_number text not null,
  hymn_title text,
  tune_name text,
  hymn_bio text,
  lyrics text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hymnal_source, hymn_number)
);

create index hymn_cache_lookup_idx
  on public.hymn_cache (hymnal_source, hymn_number);

create trigger hymn_cache_updated_at before update on public.hymn_cache
  for each row execute function set_updated_at();

alter table public.hymn_cache enable row level security;

create policy "Staff can read hymn_cache"
  on public.hymn_cache for select
  using (is_staff());

create policy "Staff can write hymn_cache"
  on public.hymn_cache for all
  using (is_staff()) with check (is_staff());

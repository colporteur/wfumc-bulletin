-- =====================================================================
-- Pastoral Voice Guide
--
-- Step 1 of the Sermon Workspace feature. Stores the pastor's writing-
-- voice instructions plus a small collection of "exemplar" past sermons
-- whose full manuscripts get fed to Claude as voice samples whenever the
-- workspace generates or revises a draft.
--
-- Two tables:
--
--   pastoral_voice_guides  — one row per user. Holds the prose voice
--                            description (theological outlook, style,
--                            tone, vocabulary preferences, things to
--                            avoid, etc.) plus a soft word-count target.
--                            Per-sermon overrides will live elsewhere
--                            (on the workspace conversation itself);
--                            this is the default that Claude starts with.
--
--   voice_exemplars        — pinned past sermons (FK to sermons) whose
--                            manuscripts should accompany the prompt.
--                            Two or three is the sweet spot. Cascades
--                            on sermon delete so a deleted exemplar
--                            silently disappears from the guide.
--
-- The table-per-user pattern (UNIQUE(owner_user_id) on the guide) keeps
-- lookups trivial — `select ... where owner_user_id = auth.uid()` and
-- you're done.
-- =====================================================================

-- 1. pastoral_voice_guides — one per user.
create table if not exists public.pastoral_voice_guides (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  -- The free-form voice description. Markdown-friendly. The workspace
  -- will inject this verbatim as part of the system prompt sent to
  -- Claude on every revision turn.
  guide_text text not null default '',
  -- Soft target the pastor wants Claude to aim for. Nullable: empty
  -- means "no specific target" and Claude won't be told a length.
  word_count_target int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One guide per user. Upserts are simple this way.
  unique (owner_user_id)
);

create trigger pastoral_voice_guides_updated_at
  before update on public.pastoral_voice_guides
  for each row execute function set_updated_at();

alter table public.pastoral_voice_guides enable row level security;

create policy "Voice guide read by owner or staff"
  on public.pastoral_voice_guides for select
  using (auth.uid() = owner_user_id or is_staff());
create policy "Voice guide insert by owner or staff"
  on public.pastoral_voice_guides for insert
  with check (auth.uid() = owner_user_id or is_staff());
create policy "Voice guide update by owner or staff"
  on public.pastoral_voice_guides for update
  using (auth.uid() = owner_user_id or is_staff());
create policy "Voice guide delete by owner or staff"
  on public.pastoral_voice_guides for delete
  using (auth.uid() = owner_user_id or is_staff());

-- 2. voice_exemplars — pinned past sermons used as voice samples.
create table if not exists public.voice_exemplars (
  id uuid primary key default gen_random_uuid(),
  voice_guide_id uuid not null references public.pastoral_voice_guides(id) on delete cascade,
  -- Denormalized owner for cheap RLS.
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  sermon_id uuid not null references public.sermons(id) on delete cascade,
  -- Manual ordering — the pastor decides which exemplar Claude sees first.
  sort_order int not null default 0,
  -- Optional reminder of why this sermon was chosen (e.g.
  -- "good narrative pacing" or "classic Wesleyan structure").
  note text,
  created_at timestamptz not null default now(),
  -- One exemplar per (guide, sermon) — no point pinning the same sermon twice.
  unique (voice_guide_id, sermon_id)
);

create index if not exists voice_exemplars_guide_idx
  on public.voice_exemplars (voice_guide_id, sort_order);
create index if not exists voice_exemplars_owner_idx
  on public.voice_exemplars (owner_user_id);

alter table public.voice_exemplars enable row level security;

create policy "Voice exemplars read by owner or staff"
  on public.voice_exemplars for select
  using (auth.uid() = owner_user_id or is_staff());
create policy "Voice exemplars insert by owner or staff"
  on public.voice_exemplars for insert
  with check (auth.uid() = owner_user_id or is_staff());
create policy "Voice exemplars update by owner or staff"
  on public.voice_exemplars for update
  using (auth.uid() = owner_user_id or is_staff());
create policy "Voice exemplars delete by owner or staff"
  on public.voice_exemplars for delete
  using (auth.uid() = owner_user_id or is_staff());

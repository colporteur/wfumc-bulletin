-- =====================================================================
-- Sermon Creative Studio — Phase 1 schema
--
-- The Creative Studio is a brainstorming surface inside the Sermon
-- Workspace. It operationalizes Todd's "sermon tips" corpus (the twelve
-- numbered PDFs: Process Guide, How to Exegete a Con-Text, BEING,
-- Preparation, Content, Craft, etc.) as an AI-assisted ideation panel
-- with three modes (exegesis / illustration / balanced), a per-call
-- model picker, and toggleable context sources (library resources now;
-- background documents arrive in Phase 2).
--
-- One table:
--
-- sermon_creative_sessions
--   One row per brainstorm thread on a sermon. The pastor can keep
--   several threads per sermon (e.g., one exegesis thread, one
--   illustration hunt). Messages persist as a JSONB array — unlike the
--   Workspace chat (sessionStorage-only, by design ephemeral), creative
--   sessions survive reloads so Tuesday's sparks are still there on
--   Thursday. At solo-pastor scale the rewrite-the-array update pattern
--   is a non-issue; revisit only if sessions ever exceed ~200 turns.
--
--   messages element shape (documented here, enforced client-side):
--     {
--       role:       'user' | 'assistant',
--       kind:       'brainstorm' | 'draft' | 'feedback',
--       content:    text,
--       mode:       'exegesis' | 'illustration' | 'balanced',
--       model:      model id string or null (proxy default),
--       techniques: [technique ids applied on this turn],
--       at:         ISO timestamp
--     }
--
-- RLS: owner-scoped (auth.uid() = owner_user_id), matching the
-- daily_captures / worship_admin_items posture. Creative scratch work
-- is personal to the pastor even though the sermons themselves are
-- more broadly readable.
-- =====================================================================

create table if not exists public.sermon_creative_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  sermon_id uuid not null references public.sermons(id) on delete cascade,

  -- Thread title. Defaults client-side to something like
  -- "Illustration hunt — Jul 12" but the pastor can rename.
  title text,

  -- Last-used mode for this thread; the UI reopens where he left off.
  mode text not null default 'balanced'
    check (mode in ('exegesis', 'illustration', 'balanced')),

  -- The conversation. See shape note in the header comment.
  messages jsonb not null default '[]'::jsonb,

  -- Soft-archive so old threads drop out of the default list without
  -- losing the ideas in them.
  archived_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger sermon_creative_sessions_updated_at
  before update on public.sermon_creative_sessions
  for each row execute function set_updated_at();

-- The only hot path: "threads for this sermon, newest first."
create index sermon_creative_sessions_sermon_idx
  on public.sermon_creative_sessions (sermon_id, updated_at desc);

create index sermon_creative_sessions_owner_idx
  on public.sermon_creative_sessions (owner_user_id);

alter table public.sermon_creative_sessions enable row level security;

create policy "Owner can read own creative sessions"
  on public.sermon_creative_sessions for select
  using (auth.uid() = owner_user_id);

create policy "Owner can insert own creative sessions"
  on public.sermon_creative_sessions for insert
  with check (auth.uid() = owner_user_id);

create policy "Owner can update own creative sessions"
  on public.sermon_creative_sessions for update
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

create policy "Owner can delete own creative sessions"
  on public.sermon_creative_sessions for delete
  using (auth.uid() = owner_user_id);

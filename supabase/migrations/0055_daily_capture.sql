-- =====================================================================
-- Daily Capture — Phase 1 schema
--
-- The Daily Capture app is a triage workflow: pastor pastes/uploads a
-- transcript (typically from Plaud Note), Claude segments + classifies
-- it, pastor reviews each segment and routes it to one or more
-- destinations across the existing apps (Pastoral Records, Sermons).
--
-- Two tables here:
--
-- 1. daily_captures
--    One row per uploaded transcript. Holds the raw text + the source
--    metadata + the extraction state machine
--    (pending → extracted → reviewed).
--
-- 2. daily_capture_segments
--    One row per Claude-detected meaningful chunk inside a capture.
--    Each segment carries Claude's proposed destinations
--    (pastoral_interaction / pastoral_note / sermon_resource), Claude's
--    detected names, and the pastor's per-segment decision (pending /
--    saved / discarded). `saved_to` records which downstream rows the
--    segment produced — used by the review UI to show "saved as
--    pastoral interaction on Mrs. Johnson + sermon resource".
--
-- Both tables are RLS-locked to auth.uid() = owner_user_id, same
-- posture as the rest of the pastoral schema. There is no is_staff()
-- escape hatch — daily captures are private to the pastor.
--
-- No privacy gates in Phase 1 (per pastor decision). When a capture is
-- inserted, its raw_text persists indefinitely. The pastor handles
-- retention manually via the app's Delete affordance. A future
-- migration could add: sealed boolean (suppress Claude extraction), an
-- auto-purge worker, or an audit trail of what Claude saw.
-- =====================================================================

-- 1. daily_captures ---------------------------------------------------

create table if not exists public.daily_captures (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  -- How the transcript was provided. Phase 1 supports only 'paste' and
  -- 'upload' (.txt / .docx). Future phases may add 'email' or 'audio'.
  source_kind text not null
    check (source_kind in ('paste', 'upload')),
  source_filename text,    -- original filename, when applicable

  -- Optional pastor-given context shown on the review screen.
  title text,              -- e.g. "Tuesday morning hospital visits"
  captured_at date,        -- the date the recording actually happened
  notes text,              -- pastor's free-form note about the capture

  -- The transcript text. Required at insert time — without a raw_text
  -- there's nothing for Claude to segment.
  raw_text text not null,

  -- Extraction state machine:
  --   'pending'   — uploaded but Claude hasn't run yet
  --   'extracted' — Claude returned segments; awaiting pastor review
  --   'reviewed'  — every segment has a decision (saved or discarded)
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending', 'extracted', 'reviewed')),
  extracted_at timestamptz,
  -- Last error message if extraction failed; null on success or
  -- when the call hasn't been made. Lets the dashboard surface
  -- "this one needs a retry" without re-running on every page load.
  extraction_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger daily_captures_updated_at
  before update on public.daily_captures
  for each row execute function set_updated_at();

create index if not exists daily_captures_owner_recent_idx
  on public.daily_captures (owner_user_id, created_at desc);

-- Dashboard surface: which captures still need action?
-- A capture needs action if it's pending (Claude not run), extracted
-- (segments waiting for review), or has any error. We rely on the
-- extraction_status partial index for the first two; review-completion
-- is computed from the segments table.
create index if not exists daily_captures_needs_action_idx
  on public.daily_captures (owner_user_id)
  where extraction_status in ('pending', 'extracted');

alter table public.daily_captures enable row level security;

create policy "Daily captures read by owner"
  on public.daily_captures for select
  using (auth.uid() = owner_user_id);
create policy "Daily captures insert by owner"
  on public.daily_captures for insert
  with check (auth.uid() = owner_user_id);
create policy "Daily captures update by owner"
  on public.daily_captures for update
  using (auth.uid() = owner_user_id);
create policy "Daily captures delete by owner"
  on public.daily_captures for delete
  using (auth.uid() = owner_user_id);

-- 2. daily_capture_segments ------------------------------------------

create table if not exists public.daily_capture_segments (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null
    references public.daily_captures(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  -- The verbatim slice of the transcript this segment covers. Claude
  -- is asked to preserve the pastor's own wording rather than
  -- paraphrase, so the review card shows something quotable.
  excerpt text not null,
  -- Claude's one-line summary, editable by the pastor on the review
  -- card. Becomes the title/headline when the segment is saved as a
  -- downstream row.
  description text,

  -- Claude's proposed routing — any non-empty subset of the canonical
  -- destination kinds. A segment may have more than one (the
  -- "prodigal-son-grandson" case lands as both a pastoral note about
  -- the family AND a sermon resource).
  --   'pastoral_interaction' — writes pastoral_interactions row(s)
  --   'pastoral_note'        — writes pastoral_notes row(s)
  --   'sermon_resource'      — writes resources row in the Sermons app
  proposed_destinations text[] not null default '{}',
  -- Names Claude detected in the segment, raw. The review UI matches
  -- these against the directory and offers a PersonPicker per name.
  mentioned_names text[] not null default '{}',
  -- Claude's reasoning. Surfaced as a tooltip on the segment card so
  -- the pastor can see why Claude flagged it the way it did.
  rationale text,

  -- The pastor's verdict on this segment.
  --   'pending'   — not yet decided (default)
  --   'saved'     — at least one downstream row was created from this
  --   'discarded' — pastor explicitly skipped it
  decision text not null default 'pending'
    check (decision in ('pending', 'saved', 'discarded')),
  decision_at timestamptz,
  -- What downstream rows this segment produced. Array of
  -- { kind, id, label } so the review UI can render a breadcrumb
  -- like "Saved as pastoral_interaction on Mrs. Johnson".
  saved_to jsonb not null default '[]'::jsonb,
  -- Pastor-typed notes about this specific segment (separate from
  -- the description, which Claude proposed).
  pastor_notes text,

  -- Stable display order: Claude returns segments in transcript order
  -- and we keep that order so the review pane reads like a timeline.
  sort_order int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger daily_capture_segments_updated_at
  before update on public.daily_capture_segments
  for each row execute function set_updated_at();

create index if not exists daily_capture_segments_capture_idx
  on public.daily_capture_segments (capture_id, sort_order);
create index if not exists daily_capture_segments_owner_idx
  on public.daily_capture_segments (owner_user_id, created_at desc);
-- Pending-review surface for the dashboard's "things waiting on you"
-- count. Partial index keeps it tiny once the review is done.
create index if not exists daily_capture_segments_pending_idx
  on public.daily_capture_segments (owner_user_id)
  where decision = 'pending';

alter table public.daily_capture_segments enable row level security;

create policy "Daily capture segments read by owner"
  on public.daily_capture_segments for select
  using (auth.uid() = owner_user_id);
create policy "Daily capture segments insert by owner"
  on public.daily_capture_segments for insert
  with check (auth.uid() = owner_user_id);
create policy "Daily capture segments update by owner"
  on public.daily_capture_segments for update
  using (auth.uid() = owner_user_id);
create policy "Daily capture segments delete by owner"
  on public.daily_capture_segments for delete
  using (auth.uid() = owner_user_id);

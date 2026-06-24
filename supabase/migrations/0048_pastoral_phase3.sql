-- =====================================================================
-- Pastoral Records — Phase 3
--
-- Five new tables covering the pastoral-history cluster:
--
--   pastoral_interactions       — visit / call / message / counseling
--                                 / wedding / funeral / etc. log
--   pastoral_transcripts        — recorded conversation transcripts
--                                 (Phase 4 will add audio import)
--   pastoral_notes              — running free-form note log,
--                                 separate from the per-person `notes`
--                                 column (which is one bag of text)
--   pastoral_core_issues        — promoted "what's currently going on
--                                 with this person" items, with a
--                                 status lifecycle and a breadcrumb
--                                 back to the source (interaction /
--                                 transcript / note) that spawned it
--   pastoral_prayer_request_links
--                              — explicit links between a directory
--                                 person and a row in the bulletin
--                                 app's prayer_requests table.
--                                 Combined with fuzzy-match in the
--                                 app, this lets the pastor confirm
--                                 / reject the auto-matched ones.
--
-- All five tables RLS-locked to auth.uid() = owner_user_id with NO
-- is_staff() escape hatch. The bulletin app's prayer_requests table
-- IS staff-readable, so this app can read it directly without a
-- special grant.
-- =====================================================================

-- 1. INTERACTIONS ----------------------------------------------------

create table if not exists public.pastoral_interactions (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.pastoral_people(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  -- What kind of interaction this was. Drives icons / filters / labels
  -- in the UI but otherwise free text.
  interaction_type text not null default 'pastoral_conversation'
    check (interaction_type in (
      'office_visit',
      'pastoral_conversation',
      'home_visit',
      'hospital_visit',
      'phone_call',
      'message',           -- text or email — lumped per pastor's call
      'counseling_session',
      'wedding',
      'funeral',
      'baptism',
      'communion_at_home',
      'other'
    )),

  -- When the interaction happened. Required so the log is sortable
  -- by date even when entries are added later from memory.
  happened_at timestamptz not null default now(),
  -- Optional duration for sessions where time matters (counseling, etc.)
  duration_minutes int,
  -- Optional location string ("UAB hospital, room 412", "Cracker Barrel").
  location text,

  -- Brief one-liner shown in the list view.
  summary text,
  -- The longer narrative.
  body text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger pastoral_interactions_updated_at
  before update on public.pastoral_interactions
  for each row execute function set_updated_at();

create index if not exists pastoral_interactions_person_idx
  on public.pastoral_interactions (person_id, happened_at desc);
create index if not exists pastoral_interactions_owner_idx
  on public.pastoral_interactions (owner_user_id);

alter table public.pastoral_interactions enable row level security;

create policy "Pastoral interactions read by owner"
  on public.pastoral_interactions for select
  using (auth.uid() = owner_user_id);
create policy "Pastoral interactions insert by owner"
  on public.pastoral_interactions for insert
  with check (auth.uid() = owner_user_id);
create policy "Pastoral interactions update by owner"
  on public.pastoral_interactions for update
  using (auth.uid() = owner_user_id);
create policy "Pastoral interactions delete by owner"
  on public.pastoral_interactions for delete
  using (auth.uid() = owner_user_id);

-- 2. TRANSCRIPTS -----------------------------------------------------

create table if not exists public.pastoral_transcripts (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.pastoral_people(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  title text,
  recorded_at timestamptz not null default now(),
  -- The full transcript text. Manually entered for now; Phase 4 will
  -- add Plaud / Google Recorder audio imports that populate this.
  transcript_text text,
  -- Pastor-written or Claude-generated short summary.
  summary text,

  -- Where this came from. 'manual' = pasted/typed. Phase 4 adds plaud,
  -- google_recorder, etc. Free text rather than an enum so the import
  -- pipeline can stamp whatever source label makes sense without a
  -- migration.
  source_type text not null default 'manual',
  -- File metadata, audio length, original filename — opaque blob the
  -- import pipeline owns. NULL for manual entries.
  source_metadata jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger pastoral_transcripts_updated_at
  before update on public.pastoral_transcripts
  for each row execute function set_updated_at();

create index if not exists pastoral_transcripts_person_idx
  on public.pastoral_transcripts (person_id, recorded_at desc);
create index if not exists pastoral_transcripts_owner_idx
  on public.pastoral_transcripts (owner_user_id);

alter table public.pastoral_transcripts enable row level security;

create policy "Pastoral transcripts read by owner"
  on public.pastoral_transcripts for select
  using (auth.uid() = owner_user_id);
create policy "Pastoral transcripts insert by owner"
  on public.pastoral_transcripts for insert
  with check (auth.uid() = owner_user_id);
create policy "Pastoral transcripts update by owner"
  on public.pastoral_transcripts for update
  using (auth.uid() = owner_user_id);
create policy "Pastoral transcripts delete by owner"
  on public.pastoral_transcripts for delete
  using (auth.uid() = owner_user_id);

-- 3. NOTES (running log) ---------------------------------------------

-- Distinct from pastoral_people.notes (the singular bag of text on
-- the row). This is a list of dated note entries — useful for "I
-- talked to Jim's wife in the parking lot today" stuff that doesn't
-- merit a full interaction log entry but should still be timestamped.

create table if not exists public.pastoral_notes (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.pastoral_people(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  body text not null,
  -- Optional pastor-set timestamp; defaults to now() for live entry.
  noted_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger pastoral_notes_updated_at
  before update on public.pastoral_notes
  for each row execute function set_updated_at();

create index if not exists pastoral_notes_person_idx
  on public.pastoral_notes (person_id, noted_at desc);
create index if not exists pastoral_notes_owner_idx
  on public.pastoral_notes (owner_user_id);

alter table public.pastoral_notes enable row level security;

create policy "Pastoral notes read by owner"
  on public.pastoral_notes for select
  using (auth.uid() = owner_user_id);
create policy "Pastoral notes insert by owner"
  on public.pastoral_notes for insert
  with check (auth.uid() = owner_user_id);
create policy "Pastoral notes update by owner"
  on public.pastoral_notes for update
  using (auth.uid() = owner_user_id);
create policy "Pastoral notes delete by owner"
  on public.pastoral_notes for delete
  using (auth.uid() = owner_user_id);

-- 4. CORE PASTORAL ISSUES --------------------------------------------

create table if not exists public.pastoral_core_issues (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.pastoral_people(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  title text not null,
  description text,

  -- Lifecycle status:
  --   open        — currently working it
  --   monitoring  — looks resolved but watching
  --   resolved    — closed; preserved for history
  status text not null default 'open'
    check (status in ('open', 'monitoring', 'resolved')),

  -- Source breadcrumb — where this issue was promoted from. NULL if
  -- the pastor entered it directly. source_type matches the table
  -- whose row triggered the promote ('interaction', 'transcript',
  -- 'note'); source_id is that row's id. We deliberately don't FK
  -- so deleting the source doesn't cascade-delete the core issue
  -- (the pastor may still want to keep tracking it).
  source_type text check (
    source_type is null
    or source_type in ('interaction', 'transcript', 'note', 'manual')
  ),
  source_id uuid,

  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger pastoral_core_issues_updated_at
  before update on public.pastoral_core_issues
  for each row execute function set_updated_at();

create index if not exists pastoral_core_issues_person_idx
  on public.pastoral_core_issues (person_id, status, created_at desc);
create index if not exists pastoral_core_issues_owner_idx
  on public.pastoral_core_issues (owner_user_id);
create index if not exists pastoral_core_issues_open_idx
  on public.pastoral_core_issues (owner_user_id, person_id)
  where status = 'open';

alter table public.pastoral_core_issues enable row level security;

create policy "Pastoral core issues read by owner"
  on public.pastoral_core_issues for select
  using (auth.uid() = owner_user_id);
create policy "Pastoral core issues insert by owner"
  on public.pastoral_core_issues for insert
  with check (auth.uid() = owner_user_id);
create policy "Pastoral core issues update by owner"
  on public.pastoral_core_issues for update
  using (auth.uid() = owner_user_id);
create policy "Pastoral core issues delete by owner"
  on public.pastoral_core_issues for delete
  using (auth.uid() = owner_user_id);

-- 5. PRAYER REQUEST LINKS --------------------------------------------

-- Explicit pastor-managed links between a directory person and a row
-- in the bulletin app's prayer_requests table. Augments the fuzzy
-- name-match the app does at display time:
--
--   relationship='made_by'   — this person submitted the request
--   relationship='for_them'  — this person is being prayed for
--   relationship='both'      — both of the above (e.g. self-request)
--   relationship='rejected'  — the auto-matcher suggested this but
--                              the pastor said no, hide it from
--                              future suggestions
--
-- The (person_id, prayer_request_id) unique constraint means each
-- pair has at most one link row, simplifying upsert logic.

create table if not exists public.pastoral_prayer_request_links (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  person_id uuid not null references public.pastoral_people(id) on delete cascade,
  prayer_request_id uuid not null references public.prayer_requests(id) on delete cascade,
  relationship text not null check (relationship in (
    'made_by', 'for_them', 'both', 'rejected'
  )),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, prayer_request_id)
);

create trigger pastoral_prayer_request_links_updated_at
  before update on public.pastoral_prayer_request_links
  for each row execute function set_updated_at();

create index if not exists pastoral_prayer_request_links_person_idx
  on public.pastoral_prayer_request_links (person_id);
create index if not exists pastoral_prayer_request_links_request_idx
  on public.pastoral_prayer_request_links (prayer_request_id);
create index if not exists pastoral_prayer_request_links_owner_idx
  on public.pastoral_prayer_request_links (owner_user_id);

alter table public.pastoral_prayer_request_links enable row level security;

create policy "Prayer request links read by owner"
  on public.pastoral_prayer_request_links for select
  using (auth.uid() = owner_user_id);
create policy "Prayer request links insert by owner"
  on public.pastoral_prayer_request_links for insert
  with check (auth.uid() = owner_user_id);
create policy "Prayer request links update by owner"
  on public.pastoral_prayer_request_links for update
  using (auth.uid() = owner_user_id);
create policy "Prayer request links delete by owner"
  on public.pastoral_prayer_request_links for delete
  using (auth.uid() = owner_user_id);

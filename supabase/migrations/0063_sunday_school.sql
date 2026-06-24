-- =====================================================================
-- Sunday School App — "Todd & Tyler's Excellent Adventure Sunday School Class"
--
-- Single-class app. Members take turns proposing a question for the
-- class to explore. Lessons get drafted between Sundays (the pick
-- happens Sunday X for the lesson on Sunday X+1).
--
-- Five tables:
--   ss_members             — class roster (pastor manages)
--   ss_topics              — question bank with state machine:
--                              possible_future → picked_for_next →
--                              active → past
--   ss_attendance          — one row per (member, meeting_date)
--                              when present=true. Absence is the
--                              absence of a row.
--   ss_lessons             — the actual lesson body for one topic
--                              (opening, pastor notes, closing,
--                              optional homework with auto-expiration)
--   ss_topic_suggestions   — public-facing submissions; auto-approved
--                              into ss_topics, but kept here for audit
--                              + pastor undo
--
-- Pastor-only RLS on the admin tables. Public-facing endpoints (Phase C)
-- will read via the public anon key against curated SELECT policies and
-- INSERT into ss_topic_suggestions anonymously.
-- =====================================================================

-- 1. ss_members ------------------------------------------------------
create table if not exists public.ss_members (
  id uuid primary key default gen_random_uuid(),
  -- Sunday School is a single-pastor / single-owner app; owner_user_id
  -- gates RLS the same as the rest of the WFUMC suite.
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  -- First name as displayed to the class. Pastor uses first names
  -- exclusively; last-name disambiguators are baked into display names
  -- (e.g., "Cynthia B", "Cynthia H", "Kathy B", "Kathy M").
  display_name text not null,
  -- Lowercased version used for alphabetical pick-rotation walk.
  -- Computed by the app on insert/update so the rotation order is
  -- deterministic and case-insensitive.
  sort_key text not null,
  -- Active = currently in the rotation. Inactive members stay in the
  -- DB (preserving historical pick / attendance records) but are
  -- skipped by the rotation and hidden from the public roster.
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger ss_members_updated_at
  before update on public.ss_members
  for each row execute function set_updated_at();

create index if not exists ss_members_owner_idx
  on public.ss_members (owner_user_id);
create index if not exists ss_members_sort_idx
  on public.ss_members (owner_user_id, active, sort_key);

alter table public.ss_members enable row level security;
create policy "ss_members read by owner" on public.ss_members
  for select using (auth.uid() = owner_user_id);
create policy "ss_members insert by owner" on public.ss_members
  for insert with check (auth.uid() = owner_user_id);
create policy "ss_members update by owner" on public.ss_members
  for update using (auth.uid() = owner_user_id);
create policy "ss_members delete by owner" on public.ss_members
  for delete using (auth.uid() = owner_user_id);

-- 2. ss_topics -------------------------------------------------------
create table if not exists public.ss_topics (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  -- The question / activity description. "(article)" suffix in some
  -- legacy entries is preserved as part of the text — it's metadata
  -- the pastor wants to keep visible, not promoted to its own column.
  text text not null,
  -- State machine. App enforces transitions:
  --   possible_future → picked_for_next (pastor or auto via rotation)
  --   picked_for_next → active (when the meeting happens)
  --   active → past (after the lesson is done)
  --   ANY → possible_future (revert / re-queue)
  status text not null default 'possible_future'
    check (status in ('possible_future','picked_for_next','active','past')),
  -- The member whose pick this is (the person who chose the topic).
  -- Null for legacy / imported past topics where we don't know who picked.
  picked_by_member_id uuid references public.ss_members(id) on delete set null,
  -- Date this topic was (or will be) discussed in class.
  discussed_on date,
  -- Free-form sort key for the possible-future list. Topics can be
  -- ordered by the pastor when planning ahead — defaults to NOW() so
  -- newest-added shows first.
  queue_sort double precision not null default extract(epoch from now()),
  -- Track origin of the submission for the public-facing form.
  submitted_by_name text,
  -- Free-form notes only the pastor sees.
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger ss_topics_updated_at
  before update on public.ss_topics
  for each row execute function set_updated_at();

create index if not exists ss_topics_owner_status_idx
  on public.ss_topics (owner_user_id, status);
create index if not exists ss_topics_queue_idx
  on public.ss_topics (owner_user_id, status, queue_sort)
  where status = 'possible_future';
create index if not exists ss_topics_discussed_idx
  on public.ss_topics (owner_user_id, discussed_on desc)
  where status = 'past';

alter table public.ss_topics enable row level security;
create policy "ss_topics read by owner" on public.ss_topics
  for select using (auth.uid() = owner_user_id);
create policy "ss_topics insert by owner" on public.ss_topics
  for insert with check (auth.uid() = owner_user_id);
create policy "ss_topics update by owner" on public.ss_topics
  for update using (auth.uid() = owner_user_id);
create policy "ss_topics delete by owner" on public.ss_topics
  for delete using (auth.uid() = owner_user_id);

-- 3. ss_attendance ---------------------------------------------------
-- One row per (member, meeting_date) when present. Recording an
-- absence means deleting the row. The unique constraint prevents
-- duplicate "present" marks for the same Sunday.
create table if not exists public.ss_attendance (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid not null references public.ss_members(id) on delete cascade,
  meeting_date date not null,
  created_at timestamptz not null default now(),
  unique (owner_user_id, member_id, meeting_date)
);

create index if not exists ss_attendance_meeting_idx
  on public.ss_attendance (owner_user_id, meeting_date);

alter table public.ss_attendance enable row level security;
create policy "ss_attendance read by owner" on public.ss_attendance
  for select using (auth.uid() = owner_user_id);
create policy "ss_attendance insert by owner" on public.ss_attendance
  for insert with check (auth.uid() = owner_user_id);
create policy "ss_attendance delete by owner" on public.ss_attendance
  for delete using (auth.uid() = owner_user_id);

-- 4. ss_lessons ------------------------------------------------------
-- The actual prepared lesson for a topic. One-to-one with ss_topics
-- (a topic gets its lesson written between the pick and the discussion).
create table if not exists public.ss_lessons (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  topic_id uuid not null references public.ss_topics(id) on delete cascade,
  -- Optional: extra opening prompt above the bullet notes.
  opening_prompt text,
  -- The bulleted pastor notes ("A few random thoughts from Pastor Todd").
  -- Stored as plain text; line-per-bullet convention. Editor splits/joins.
  pastor_notes text default '',
  -- Closing prompt — typically "What are your thoughts?" but configurable.
  closing_prompt text default 'What are your thoughts?',
  -- Optional homework notice. Visible on the public-facing active-lesson
  -- view until homework_expires_at passes (default: the upcoming Sunday
  -- at 9:30 AM CST, the class start time, computed by the app on save).
  homework_text text,
  homework_expires_at timestamptz,
  -- Import provenance (Phase D / D2 back-catalog importer will fill these).
  imported_from text,
  import_source_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One lesson per topic. If the pastor wants alternate drafts, that's
  -- handled in-app via revision history (future phase), not duplicate rows.
  unique (topic_id)
);

create trigger ss_lessons_updated_at
  before update on public.ss_lessons
  for each row execute function set_updated_at();

create index if not exists ss_lessons_owner_idx
  on public.ss_lessons (owner_user_id);
create index if not exists ss_lessons_homework_idx
  on public.ss_lessons (homework_expires_at)
  where homework_text is not null;

alter table public.ss_lessons enable row level security;
create policy "ss_lessons read by owner" on public.ss_lessons
  for select using (auth.uid() = owner_user_id);
create policy "ss_lessons insert by owner" on public.ss_lessons
  for insert with check (auth.uid() = owner_user_id);
create policy "ss_lessons update by owner" on public.ss_lessons
  for update using (auth.uid() = owner_user_id);
create policy "ss_lessons delete by owner" on public.ss_lessons
  for delete using (auth.uid() = owner_user_id);

-- 5. ss_topic_suggestions --------------------------------------------
-- Public-facing submissions. Auto-approved into ss_topics on insert
-- (Phase C will trigger an insert into ss_topics on commit), but the
-- row is retained as an audit/undo trail.
--
-- Anonymous INSERT is enabled — anyone with the URL can submit a topic.
-- Anonymous SELECT is NOT enabled (pastor reviews via app).
create table if not exists public.ss_topic_suggestions (
  id uuid primary key default gen_random_uuid(),
  -- owner_user_id is set server-side by the public-facing endpoint
  -- (Phase C); the public form doesn't supply it. For now, the pastor
  -- supplies it directly when adding via the admin UI.
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  submitter_name text not null,
  -- True once the pastor has actioned this (auto-approved at INSERT
  -- creates a corresponding ss_topics row and sets this true).
  processed boolean not null default false,
  created_topic_id uuid references public.ss_topics(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists ss_topic_suggestions_owner_idx
  on public.ss_topic_suggestions (owner_user_id, processed);

alter table public.ss_topic_suggestions enable row level security;
-- Pastor read/update/delete (review surface)
create policy "ss_suggestions read by owner" on public.ss_topic_suggestions
  for select using (auth.uid() = owner_user_id);
create policy "ss_suggestions update by owner" on public.ss_topic_suggestions
  for update using (auth.uid() = owner_user_id);
create policy "ss_suggestions delete by owner" on public.ss_topic_suggestions
  for delete using (auth.uid() = owner_user_id);
-- INSERT permissions are intentionally left without a policy here —
-- Phase C will add a public-anon INSERT policy + server-side
-- owner_user_id stamping. For Phase A, the pastor inserts via the
-- authenticated admin UI which uses the owner check below.
create policy "ss_suggestions insert by owner" on public.ss_topic_suggestions
  for insert with check (auth.uid() = owner_user_id);

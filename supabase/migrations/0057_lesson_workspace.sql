-- =====================================================================
-- Lesson Maker — Phase B schema
--
-- Adds the Workspace-style chat-revise loop infrastructure:
--
--   1. lesson_revisions — snapshot rows captured on every Claude turn
--      and on each manual unlock-with-edits, so any prior body can be
--      reverted to.
--   2. lessons.body_locked — boolean flag. While locked, the body
--      textarea is read-only; Claude can still revise it through the
--      chat panel. Unlocking auto-snapshots first.
--   3. lessons.attached_resource_ids — uuid[] of resources (from the
--      shared `resources` table populated by the Sermons app) that are
--      in context for this lesson. Selected via the ResourcePicker;
--      their text gets injected into Claude's system prompt on chat
--      turns and the scripture suggester.
--
-- All RLS owner-scoped to auth.uid().
-- =====================================================================

-- 1. lesson_revisions ------------------------------------------------

create table if not exists public.lesson_revisions (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  -- Denormalized owner (always matches the parent lesson) so RLS can
  -- run without a join.
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  -- Frozen snapshot of the lesson's editable text at this revision.
  -- Mirrors the user-editable columns on `lessons` so a revert can
  -- restore them all atomically.
  snapshot_title text,
  snapshot_scripture_reference text,
  snapshot_body text,
  snapshot_themes text[],
  snapshot_class_notes text,

  -- Why this snapshot was taken. Free-text, but the app uses a small
  -- set of values: 'chat_turn', 'manual_unlock', 'manual_save',
  -- 'pre_revert', 'import'.
  source text,

  -- Optional human-readable label, e.g. "Before tightening intro".
  label text,

  created_at timestamptz not null default now()
);

create index if not exists lesson_revisions_lesson_idx
  on public.lesson_revisions (lesson_id, created_at desc);
create index if not exists lesson_revisions_owner_idx
  on public.lesson_revisions (owner_user_id);

alter table public.lesson_revisions enable row level security;

create policy "Lesson revisions read by owner"
  on public.lesson_revisions for select
  using (auth.uid() = owner_user_id);
create policy "Lesson revisions insert by owner"
  on public.lesson_revisions for insert
  with check (auth.uid() = owner_user_id);
create policy "Lesson revisions update by owner"
  on public.lesson_revisions for update
  using (auth.uid() = owner_user_id);
create policy "Lesson revisions delete by owner"
  on public.lesson_revisions for delete
  using (auth.uid() = owner_user_id);

-- 2. lessons.body_locked + attached_resource_ids ---------------------

alter table public.lessons
  add column if not exists body_locked boolean not null default false,
  -- Resources (cross-app reference into the shared `resources` table
  -- populated by the Sermons app) currently in context for this lesson.
  -- Stored as a uuid[] rather than a join table because (a) order
  -- matters for display in the workspace, (b) it's always a small set
  -- (<20 typical), and (c) lessons + resources share an owner so RLS
  -- on the resources read side handles permissions.
  add column if not exists attached_resource_ids uuid[] not null default '{}';

-- GIN index in case we later want to find "lessons that reference this
-- resource" (for the resource-reuse-tracker on the Sermons-side detail
-- page).
create index if not exists lessons_attached_resources_idx
  on public.lessons using gin (attached_resource_ids);

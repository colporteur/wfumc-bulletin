-- =====================================================================
-- Lesson Maker — Phase D schema
--
-- Per-group queue of upcoming lessons. The pastor builds up a queue
-- for each group ahead of time (often after sermon prep gives him a
-- handful of fresh ideas), then on meeting day uses "Start from queue"
-- to pull the top entry and pre-fill Record Use.
--
-- Auto-pop semantics: when a lesson_use row is inserted for a
-- (lesson_id, group_id) pair, the matching queue entry is deleted by
-- the app's recordUse helper. The DB doesn't enforce this — keeping
-- the policy in app code lets a future "use without unqueueing" flow
-- (e.g., re-teaching from the queue) opt out without a schema change.
-- =====================================================================

create table if not exists public.lesson_queue (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  group_id uuid not null references public.lesson_groups(id) on delete cascade,
  -- Denormalized for cheap RLS.
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  -- Order WITHIN the group's queue. The app reassigns these on every
  -- move; gaps don't matter (we re-densify on save).
  sort_order int not null default 0,

  created_at timestamptz not null default now()
);

-- A given lesson can't be queued for the same group twice. addToQueue
-- in the app is also idempotent (it checks first and returns the
-- existing row), but the unique index is the belt to the suspenders.
create unique index if not exists lesson_queue_uniq
  on public.lesson_queue (group_id, lesson_id);

-- Primary query path: list a group's queue in order.
create index if not exists lesson_queue_group_order_idx
  on public.lesson_queue (group_id, sort_order);

-- Secondary path: "which groups have this lesson queued?" (LessonDetail).
create index if not exists lesson_queue_lesson_idx
  on public.lesson_queue (lesson_id);

create index if not exists lesson_queue_owner_idx
  on public.lesson_queue (owner_user_id);

alter table public.lesson_queue enable row level security;

create policy "Lesson queue read by owner"
  on public.lesson_queue for select
  using (auth.uid() = owner_user_id);
create policy "Lesson queue insert by owner"
  on public.lesson_queue for insert
  with check (auth.uid() = owner_user_id);
create policy "Lesson queue update by owner"
  on public.lesson_queue for update
  using (auth.uid() = owner_user_id);
create policy "Lesson queue delete by owner"
  on public.lesson_queue for delete
  using (auth.uid() = owner_user_id);

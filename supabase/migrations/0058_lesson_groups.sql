-- =====================================================================
-- Lesson Maker — Phase C schema
--
-- Adds the "groups + members + rotation tracker" layer:
--
--   1. lesson_groups        — the small-group container (Tuesday Bible
--                             study, women's Wednesday group, etc.)
--   2. lesson_group_members — many-to-many between lesson_groups and
--                             pastoral_people (the Pastoral Records
--                             roster IS the source of truth for who's
--                             in a group)
--   3. lesson_uses          — record that lesson X was used by group Y
--                             on date Z. Powers the bidirectional
--                             rotation tracker:
--                               • per-group: "lessons not yet used"
--                               • per-lesson: "used by these groups
--                                 on these dates"
--
-- All RLS owner-scoped to auth.uid(). Cross-table integrity uses real
-- foreign keys with ON DELETE CASCADE so removing a group cleans up
-- its members and uses, and removing a lesson cleans up its uses.
-- =====================================================================

-- 1. lesson_groups ---------------------------------------------------

create table if not exists public.lesson_groups (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  -- Required handle for the group.
  name text not null,

  -- Free-text meeting cadence ("Tuesdays 10:00 AM", "1st Sunday after
  -- lunch", etc.). Kept as free text rather than structured fields
  -- because real-world groups have weird patterns and the rotation
  -- tracker doesn't need this for math.
  meeting_day_time text,
  location text,
  description text,

  -- Soft-delete via flag. Archived groups stay queryable for historical
  -- rotation lookups ("this lesson was last used by Lenten Study 2024")
  -- but get filtered out of the active-groups list by default.
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger lesson_groups_updated_at
  before update on public.lesson_groups
  for each row execute function set_updated_at();

create index if not exists lesson_groups_owner_active_idx
  on public.lesson_groups (owner_user_id, is_active, name);

alter table public.lesson_groups enable row level security;

create policy "Lesson groups read by owner"
  on public.lesson_groups for select
  using (auth.uid() = owner_user_id);
create policy "Lesson groups insert by owner"
  on public.lesson_groups for insert
  with check (auth.uid() = owner_user_id);
create policy "Lesson groups update by owner"
  on public.lesson_groups for update
  using (auth.uid() = owner_user_id);
create policy "Lesson groups delete by owner"
  on public.lesson_groups for delete
  using (auth.uid() = owner_user_id);

-- 2. lesson_group_members --------------------------------------------
--
-- Link from a group to a person. The person ALWAYS lives in
-- pastoral_people — we don't store names here. That way updating a
-- person's name in Pastoral Records flows everywhere, and we get a
-- single source of truth for "who is this".

create table if not exists public.lesson_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.lesson_groups(id) on delete cascade,
  -- Denormalized for cheap RLS.
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  -- Hard FK to pastoral_people. If a person gets deleted from the
  -- directory, their group memberships go with them (cascade) — that's
  -- the desired behavior, since the group has no name of its own to
  -- fall back on.
  person_id uuid not null references public.pastoral_people(id) on delete cascade,

  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- A given person can't be added to the same group twice.
create unique index if not exists lesson_group_members_uniq
  on public.lesson_group_members (group_id, person_id);

create index if not exists lesson_group_members_owner_idx
  on public.lesson_group_members (owner_user_id);

alter table public.lesson_group_members enable row level security;

create policy "Lesson group members read by owner"
  on public.lesson_group_members for select
  using (auth.uid() = owner_user_id);
create policy "Lesson group members insert by owner"
  on public.lesson_group_members for insert
  with check (auth.uid() = owner_user_id);
create policy "Lesson group members update by owner"
  on public.lesson_group_members for update
  using (auth.uid() = owner_user_id);
create policy "Lesson group members delete by owner"
  on public.lesson_group_members for delete
  using (auth.uid() = owner_user_id);

-- 3. lesson_uses -----------------------------------------------------
--
-- "Lesson X was used by group Y on date Z." Both lesson and group are
-- required. Future phases may add who_picked_id (PersonPicker) and
-- notes, but Phase C deliberately keeps it minimal.

create table if not exists public.lesson_uses (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  group_id uuid not null references public.lesson_groups(id) on delete cascade,
  -- Denormalized for cheap RLS.
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  used_on date not null,

  created_at timestamptz not null default now()
);

-- Per-lesson rotation panel: "where has this lesson been used?"
-- Sorted by date desc so the most recent use comes first.
create index if not exists lesson_uses_lesson_idx
  on public.lesson_uses (lesson_id, used_on desc);

-- Per-group rotation panel: "which lessons has this group used?"
-- Sorted by date desc so the most recent use comes first.
create index if not exists lesson_uses_group_idx
  on public.lesson_uses (group_id, used_on desc);

create index if not exists lesson_uses_owner_idx
  on public.lesson_uses (owner_user_id);

alter table public.lesson_uses enable row level security;

create policy "Lesson uses read by owner"
  on public.lesson_uses for select
  using (auth.uid() = owner_user_id);
create policy "Lesson uses insert by owner"
  on public.lesson_uses for insert
  with check (auth.uid() = owner_user_id);
create policy "Lesson uses update by owner"
  on public.lesson_uses for update
  using (auth.uid() = owner_user_id);
create policy "Lesson uses delete by owner"
  on public.lesson_uses for delete
  using (auth.uid() = owner_user_id);

-- =====================================================================
-- Shared resource libraries
--
-- Pastor Todd and his wife (different churches, but both preach) want
-- to pool their sermon-prep resources. Other arrangements (a co-pastor
-- joining, a writers' group sharing) should also fit cleanly.
--
-- Model:
--   resource_libraries          — named collections (e.g., "Pastoral
--                                  Resources", "Wedowee Worship Team")
--   resource_library_members    — many-to-many: which users belong to
--                                  which libraries
--   resources.library_id        — which library a resource lives in
--                                  (NULL = personal, owner-only)
--
-- A resource is visible to:
--   - its owner (always), AND
--   - if library_id is set, every member of that library.
--
-- Sermon links (sermon_resources) stay private — both pastors can use
-- the same shared "lost sheep" story but each only sees which of their
-- own sermons they used it in.
-- =====================================================================

-- 1. Libraries
create table if not exists public.resource_libraries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists resource_libraries_created_by_idx
  on public.resource_libraries (created_by);

alter table public.resource_libraries enable row level security;

-- 2. Members
create table if not exists public.resource_library_members (
  library_id uuid not null references public.resource_libraries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  added_by uuid references auth.users(id) on delete set null,
  primary key (library_id, user_id)
);

create index if not exists resource_library_members_user_idx
  on public.resource_library_members (user_id);

alter table public.resource_library_members enable row level security;

-- Helper: am I a member of <library>?
create or replace function public.is_library_member(p_library_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.resource_library_members m
    where m.library_id = p_library_id
      and m.user_id = auth.uid()
  );
$$;

-- 3. Library RLS — visible if you're a member; creator can update/delete.
create policy "Library read by members"
  on public.resource_libraries for select
  using (is_library_member(id) or created_by = auth.uid() or is_staff());

create policy "Library insert by authenticated"
  on public.resource_libraries for insert
  with check (auth.uid() = created_by);

create policy "Library update by creator or staff"
  on public.resource_libraries for update
  using (created_by = auth.uid() or is_staff());

create policy "Library delete by creator or staff"
  on public.resource_libraries for delete
  using (created_by = auth.uid() or is_staff());

-- 4. Member RLS — members can see who else is in the library; creator
--    or members can add/remove (we'll constrain this further at app level
--    if needed, but for a small pastor-collective it's fine).
create policy "Member read by library members"
  on public.resource_library_members for select
  using (
    user_id = auth.uid()
    or is_library_member(library_id)
    or is_staff()
  );

create policy "Member insert by library member or creator"
  on public.resource_library_members for insert
  with check (
    -- Either you're already a member (so you can invite others)
    is_library_member(library_id)
    -- Or you're the library creator (handles the very first member, which
    -- is yourself)
    or exists (
      select 1 from public.resource_libraries l
      where l.id = library_id and l.created_by = auth.uid()
    )
    or is_staff()
  );

create policy "Member delete by self, member, or staff"
  on public.resource_library_members for delete
  using (
    user_id = auth.uid()
    or is_library_member(library_id)
    or is_staff()
  );

-- 5. Resources: add library_id, expand RLS
alter table public.resources
  add column if not exists library_id uuid
    references public.resource_libraries(id) on delete set null;

create index if not exists resources_library_idx
  on public.resources (library_id);

-- Replace the owner-only read policy with one that ALSO allows library
-- members to read.
drop policy if exists "Resource read by owner or staff" on public.resources;
create policy "Resource read by owner or library member"
  on public.resources for select
  using (
    auth.uid() = owner_user_id
    or (library_id is not null and is_library_member(library_id))
    or is_staff()
  );

-- Inserts: stamp owner = self; library_id (if set) must be one you can see.
drop policy if exists "Resource insert by owner or staff" on public.resources;
create policy "Resource insert by owner into visible library"
  on public.resources for insert
  with check (
    (auth.uid() = owner_user_id or is_staff())
    and (
      library_id is null
      or is_library_member(library_id)
      or is_staff()
    )
  );

-- Updates: owner OR any library member of the resource's current library.
-- This is the "pooled library" semantics — co-members can edit each
-- other's contributions.
drop policy if exists "Resource update by owner or staff" on public.resources;
create policy "Resource update by owner or library member"
  on public.resources for update
  using (
    auth.uid() = owner_user_id
    or (library_id is not null and is_library_member(library_id))
    or is_staff()
  );

-- Deletes: same as updates (members can clean up).
drop policy if exists "Resource delete by owner or staff" on public.resources;
create policy "Resource delete by owner or library member"
  on public.resources for delete
  using (
    auth.uid() = owner_user_id
    or (library_id is not null and is_library_member(library_id))
    or is_staff()
  );

-- 6. sermon_resources: a resource visible to me via library membership
--    should still be linkable from MY sermons. The existing RLS keys off
--    owner_user_id (the user who created the link), which already works
--    because each user creates links to their own sermons. No changes
--    needed here — just confirming the model is consistent.

-- 7. find_user_id_by_email — RPC for the member-add UI
--
-- The auth.users table is locked down; the UI needs to translate an email
-- to a user_id when inviting a co-member. SECURITY DEFINER bypasses
-- RLS, but we only return the id (not email/password/etc) and gate
-- with role check.
create or replace function public.find_user_id_by_email(p_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_email is null or length(trim(p_email)) = 0 then
    return null;
  end if;
  select id into v_id
  from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1;
  return v_id;
end;
$$;

revoke all on function public.find_user_id_by_email(text) from public;
grant execute on function public.find_user_id_by_email(text) to authenticated;

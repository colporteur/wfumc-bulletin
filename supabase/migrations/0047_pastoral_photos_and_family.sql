-- =====================================================================
-- Pastoral Records — Phase 2: photos, family links, extended family
--
-- Three new tables plus a private storage bucket. Like Phase 1, every
-- table's RLS is locked to auth.uid() = owner_user_id with NO is_staff()
-- escape hatch — these are pastoral records, not staff-shared data.
--
-- 1. pastoral_people_photos
--    Per-person image gallery. One row per upload. is_main flagged with
--    a partial unique index so each person has at most one "main"
--    photo. The actual image bytes live in the pastoral-photos bucket
--    under <owner_user_id>/<person_id>/...
--
-- 2. pastoral_family_links
--    Bidirectional family relationships between two pastoral_people
--    rows. One row per relationship. relationship_a_to_b describes a's
--    role from b's perspective (e.g. parent → b is a's child). When
--    we display from b's side, the app inverts.
--
-- 3. pastoral_extended_family
--    Child records under a pastoral_people row, for relatives who
--    AREN'T in the pastor's directory (the cousin in Florida, the
--    deceased grandmother). Different from pastoral_family_links,
--    which connects two directory entries.
--
-- Storage: pastoral-photos bucket. PRIVATE — unlike sermon-slide-decks
-- (which is public-read for easy <img src=…> rendering), pastoral
-- photos must never be publicly accessible. Path layout:
--   <owner_user_id>/<person_id>/<timestamp>-<random>.jpg
-- RLS on storage.objects checks the leading folder against auth.uid()
-- so even another authenticated WFUMC staff member can't read another
-- pastor's pastoral-photo files.
-- =====================================================================

-- 1. PHOTOS ----------------------------------------------------------

create table if not exists public.pastoral_people_photos (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.pastoral_people(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  -- Storage path inside the pastoral-photos bucket. Required.
  storage_path text not null,
  -- Original filename so the gallery can show "IMG_4321.jpg" if the
  -- pastor wants to remember which device shot it.
  original_filename text,
  -- Optional caption — "At Tom's 80th birthday party" etc.
  caption text,

  -- Exactly one main photo per person, enforced by the partial unique
  -- index below. Default false; the photo upload helper flips this
  -- on the first upload so the person immediately has a thumbnail.
  is_main boolean not null default false,

  -- Free-form ordering for non-main photos in the gallery.
  sort_order int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger pastoral_people_photos_updated_at
  before update on public.pastoral_people_photos
  for each row execute function set_updated_at();

create index if not exists pastoral_people_photos_person_idx
  on public.pastoral_people_photos (person_id, sort_order);
create index if not exists pastoral_people_photos_owner_idx
  on public.pastoral_people_photos (owner_user_id);

-- At most one main photo per person.
create unique index if not exists pastoral_people_photos_one_main_per_person
  on public.pastoral_people_photos (person_id)
  where is_main = true;

alter table public.pastoral_people_photos enable row level security;

create policy "Pastoral photos read by owner"
  on public.pastoral_people_photos for select
  using (auth.uid() = owner_user_id);
create policy "Pastoral photos insert by owner"
  on public.pastoral_people_photos for insert
  with check (auth.uid() = owner_user_id);
create policy "Pastoral photos update by owner"
  on public.pastoral_people_photos for update
  using (auth.uid() = owner_user_id);
create policy "Pastoral photos delete by owner"
  on public.pastoral_people_photos for delete
  using (auth.uid() = owner_user_id);

-- 2. FAMILY LINKS ----------------------------------------------------

create table if not exists public.pastoral_family_links (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  person_a_id uuid not null references public.pastoral_people(id) on delete cascade,
  person_b_id uuid not null references public.pastoral_people(id) on delete cascade,

  -- Relationship described from A's perspective:
  --   spouse        — b is a's spouse           (symmetric)
  --   sibling       — b is a's sibling          (symmetric)
  --   parent        — b is a's parent           (inverse: child)
  --   child         — b is a's child            (inverse: parent)
  --   grandparent   — b is a's grandparent      (inverse: grandchild)
  --   grandchild    — b is a's grandchild       (inverse: grandparent)
  --   aunt_uncle    — b is a's aunt or uncle    (inverse: niece_nephew)
  --   niece_nephew  — b is a's niece or nephew  (inverse: aunt_uncle)
  --   cousin        — b is a's cousin           (symmetric)
  --   in_law        — b is a's in-law           (symmetric)
  --   other         — free-form (uses the notes field for specifics)
  relationship_a_to_b text not null check (relationship_a_to_b in (
    'spouse', 'sibling', 'parent', 'child', 'grandparent', 'grandchild',
    'aunt_uncle', 'niece_nephew', 'cousin', 'in_law', 'other'
  )),
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (person_a_id <> person_b_id)
);

create trigger pastoral_family_links_updated_at
  before update on public.pastoral_family_links
  for each row execute function set_updated_at();

create index if not exists pastoral_family_links_a_idx
  on public.pastoral_family_links (person_a_id);
create index if not exists pastoral_family_links_b_idx
  on public.pastoral_family_links (person_b_id);
create index if not exists pastoral_family_links_owner_idx
  on public.pastoral_family_links (owner_user_id);

alter table public.pastoral_family_links enable row level security;

create policy "Family links read by owner"
  on public.pastoral_family_links for select
  using (auth.uid() = owner_user_id);
create policy "Family links insert by owner"
  on public.pastoral_family_links for insert
  with check (auth.uid() = owner_user_id);
create policy "Family links update by owner"
  on public.pastoral_family_links for update
  using (auth.uid() = owner_user_id);
create policy "Family links delete by owner"
  on public.pastoral_family_links for delete
  using (auth.uid() = owner_user_id);

-- 3. EXTENDED FAMILY -------------------------------------------------

create table if not exists public.pastoral_extended_family (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.pastoral_people(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  -- The relative.
  name text not null,
  -- Where they live. Free-form ("Birmingham, AL", "out of state", etc.)
  location text,
  -- Optional demographics.
  gender text,        -- free-form so the pastor isn't forced into a binary
  age text,           -- text not int — covers "early 60s", "deceased",
                      -- "infant", etc. without overengineering
  -- "daughter", "son-in-law", "great-aunt on mother's side", etc.
  relationship text,
  -- Visit history — a free-form running log. Newest visits at top,
  -- pastor's choice. (A future phase may promote this to a proper
  -- visits table parallel to pastoral interaction logs.)
  visit_history text,
  -- Catch-all notes about the relative.
  notes text,

  -- Soft sort within the parent person's extended-family list.
  sort_order int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger pastoral_extended_family_updated_at
  before update on public.pastoral_extended_family
  for each row execute function set_updated_at();

create index if not exists pastoral_extended_family_person_idx
  on public.pastoral_extended_family (person_id, sort_order);
create index if not exists pastoral_extended_family_owner_idx
  on public.pastoral_extended_family (owner_user_id);

alter table public.pastoral_extended_family enable row level security;

create policy "Extended family read by owner"
  on public.pastoral_extended_family for select
  using (auth.uid() = owner_user_id);
create policy "Extended family insert by owner"
  on public.pastoral_extended_family for insert
  with check (auth.uid() = owner_user_id);
create policy "Extended family update by owner"
  on public.pastoral_extended_family for update
  using (auth.uid() = owner_user_id);
create policy "Extended family delete by owner"
  on public.pastoral_extended_family for delete
  using (auth.uid() = owner_user_id);

-- 4. STORAGE BUCKET --------------------------------------------------
--
-- PRIVATE bucket. No public-read policy. Files are served via signed
-- URLs (storage.createSignedUrl) from the app, which only the pastor
-- can request because the client SDK uses their session.

insert into storage.buckets (id, name, public, file_size_limit)
values ('pastoral-photos', 'pastoral-photos', false, 10485760)  -- 10 MB
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760;

-- Path layout: <owner_user_id>/<person_id>/<timestamp>-<random>.jpg
-- The storage policies use storage.foldername() to extract the leading
-- folder and check it against auth.uid()::text. This way different
-- pastors using the same Supabase project can each upload but cannot
-- read each other's pastoral photos even with a stolen storage_path.

drop policy if exists "Pastoral photos read by owner folder" on storage.objects;
create policy "Pastoral photos read by owner folder"
  on storage.objects for select
  using (
    bucket_id = 'pastoral-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Pastoral photos insert by owner folder" on storage.objects;
create policy "Pastoral photos insert by owner folder"
  on storage.objects for insert
  with check (
    bucket_id = 'pastoral-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Pastoral photos update by owner folder" on storage.objects;
create policy "Pastoral photos update by owner folder"
  on storage.objects for update
  using (
    bucket_id = 'pastoral-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Pastoral photos delete by owner folder" on storage.objects;
create policy "Pastoral photos delete by owner folder"
  on storage.objects for delete
  using (
    bucket_id = 'pastoral-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- =====================================================================
-- Pastoral Records — Phase 5
--
-- Faith background, personal preferences, pets, and significant
-- deceased relationships.
--
-- Two columns added to pastoral_people:
--   faith_background       — narrative text field (the pastor writes
--                            prose, not structured form fields)
--   personal_preferences   — JSONB array of {label, value} pairs
--                            (mirrors social_media_profiles)
--
-- Two new tables:
--   pastoral_pets                  — sub-records for the person's pets,
--                                    living + deceased; useful for
--                                    "How is Buddy?" / "I'm sorry
--                                    about Whiskers" pastoral memory
--   pastoral_significant_deaths    — relatives + close friends who
--                                    have died, with date_of_death;
--                                    powers anniversary-aware pastoral
--                                    care later
--
-- Both tables use the same RLS pattern: auth.uid() = owner_user_id,
-- no is_staff() escape hatch.
-- =====================================================================

-- Columns on pastoral_people ----------------------------------------

alter table public.pastoral_people
  add column if not exists faith_background text;

alter table public.pastoral_people
  add column if not exists personal_preferences jsonb not null default '[]'::jsonb;

-- pastoral_pets -----------------------------------------------------

create table if not exists public.pastoral_pets (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.pastoral_people(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  name text not null,
  -- Free-form so the pastor isn't forced into a closed enum:
  --   "dog", "cat", "parakeet", "rescue mutt — part Lab maybe?"
  species text,

  -- Lifecycle. NOT a rich animal-care system; just enough so the
  -- pastor can recall whether a pet is current ("How is Buddy?") or
  -- mourned ("I'm sorry about Whiskers — when did she pass?").
  status text not null default 'living'
    check (status in ('living', 'deceased')),
  date_of_death date,

  notes text,
  sort_order int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger pastoral_pets_updated_at
  before update on public.pastoral_pets
  for each row execute function set_updated_at();

create index if not exists pastoral_pets_person_idx
  on public.pastoral_pets (person_id, sort_order);
create index if not exists pastoral_pets_owner_idx
  on public.pastoral_pets (owner_user_id);

alter table public.pastoral_pets enable row level security;

create policy "Pastoral pets read by owner"
  on public.pastoral_pets for select
  using (auth.uid() = owner_user_id);
create policy "Pastoral pets insert by owner"
  on public.pastoral_pets for insert
  with check (auth.uid() = owner_user_id);
create policy "Pastoral pets update by owner"
  on public.pastoral_pets for update
  using (auth.uid() = owner_user_id);
create policy "Pastoral pets delete by owner"
  on public.pastoral_pets for delete
  using (auth.uid() = owner_user_id);

-- pastoral_significant_deaths ---------------------------------------

create table if not exists public.pastoral_significant_deaths (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.pastoral_people(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  -- The person who died (free text — they may or may not be in the
  -- pastoral directory themselves).
  name text not null,
  -- "Spouse", "Mother", "Best friend from college", etc. Free text.
  relationship text,
  -- When they died. Required so anniversary-aware pastoral care can
  -- surface upcoming dates on the dashboard later.
  date_of_death date,
  -- Anything pastoral the pastor wants to remember — "Was estranged
  -- at the time of his death", "Rebecca still tears up when his name
  -- comes up", etc.
  notes text,
  sort_order int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger pastoral_significant_deaths_updated_at
  before update on public.pastoral_significant_deaths
  for each row execute function set_updated_at();

create index if not exists pastoral_significant_deaths_person_idx
  on public.pastoral_significant_deaths (person_id, sort_order);
create index if not exists pastoral_significant_deaths_owner_idx
  on public.pastoral_significant_deaths (owner_user_id);
-- Anniversary-style lookup: who died around (today)?
create index if not exists pastoral_significant_deaths_owner_date_idx
  on public.pastoral_significant_deaths (owner_user_id, date_of_death);

alter table public.pastoral_significant_deaths enable row level security;

create policy "Significant deaths read by owner"
  on public.pastoral_significant_deaths for select
  using (auth.uid() = owner_user_id);
create policy "Significant deaths insert by owner"
  on public.pastoral_significant_deaths for insert
  with check (auth.uid() = owner_user_id);
create policy "Significant deaths update by owner"
  on public.pastoral_significant_deaths for update
  using (auth.uid() = owner_user_id);
create policy "Significant deaths delete by owner"
  on public.pastoral_significant_deaths for delete
  using (auth.uid() = owner_user_id);

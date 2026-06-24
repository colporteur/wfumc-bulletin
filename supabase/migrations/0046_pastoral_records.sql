-- =====================================================================
-- Pastoral Records — Phase 1 schema
--
-- A private directory the pastor uses to record everyone they minister
-- with, from active church members to extended family of parishioners.
-- This is the most sensitive data in the WFUMC suite — pastoral
-- conversations, faith struggles, family history — so RLS is locked
-- to auth.uid() = owner_user_id with NO is_staff() escape hatch.
-- Office admins, music directors, etc. cannot read or write these
-- rows. The app's UI also gates access to pastor role for belt-and-
-- suspenders defense in depth.
--
-- Phase 1 covers identity, contact, status, baptism, anniversary,
-- birthdate, church-membership date, and church roles. Photos,
-- family relationship links, interaction logs, audio imports, prayer
-- request linking, eulogy tooling, and document archive are deferred
-- to Phases 2-7 (each its own follow-up migration).
-- =====================================================================

create table if not exists public.pastoral_people (
  id uuid primary key default gen_random_uuid(),
  -- The pastor who owns the record. Always set to auth.uid() at
  -- insert time; RLS pins SELECT/INSERT/UPDATE/DELETE to the row's
  -- owner so different pastors using the same Supabase project see
  -- entirely separate directories.
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  -- Name fields ---------------------------------------------------
  first_name text not null,
  middle_name text,
  last_name text,
  preferred_name text,

  -- Contact -------------------------------------------------------
  cell_phone text,
  home_phone text,
  email text,
  -- Multiple social media profiles. Stored as a JSON array of
  -- { label: 'Facebook', url: 'https://...' } objects so the pastor
  -- can add as many as they want without schema changes.
  social_media_profiles jsonb not null default '[]'::jsonb,

  -- Primary address (within Wedowee, typically) -------------------
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  zip text,

  -- Secondary address (the "elsewhere" residence). Surfaced when
  -- has_house_in_wedowee_resides_elsewhere is true.
  has_house_in_wedowee_resides_elsewhere boolean not null default false,
  secondary_address_line1 text,
  secondary_address_line2 text,
  secondary_city text,
  secondary_state text,
  secondary_zip text,

  -- Personal dates ------------------------------------------------
  birthdate date,
  anniversary date,

  -- Church status flags. These are NOT mutually exclusive — someone
  -- can be both a church member AND on the active visitor list during
  -- a transition period, etc.
  is_church_member boolean not null default false,
  date_joined_church date,
  is_active_visitor boolean not null default false,
  is_extended_family boolean not null default false,
  is_non_active_visitor boolean not null default false,

  -- Baptism. Tri-state because "unknown" is a real, meaningful answer
  -- in pastoral context — "no" can be a conversion opportunity.
  baptism_status text not null default 'unknown'
    check (baptism_status in ('yes', 'no', 'unknown')),
  baptism_date date,

  -- Church roles the person holds. Free-form text array (e.g.
  -- "SPRC chair", "Trustee", "Sunday School teacher") so we don't
  -- have to maintain a closed enumeration of possible roles.
  church_roles text[] not null default array[]::text[],

  -- Personal touch ------------------------------------------------
  on_christmas_card_list boolean not null default false,

  -- Generic notes field — anything that doesn't fit the structured
  -- fields. Pastoral interaction logs (Phase 3) and core pastoral
  -- issues (Phase 3) live in their own tables.
  notes text,

  -- Soft-delete / deceased marker ---------------------------------
  -- Phase 6 will add the deceased workflow proper (death_date,
  -- obituary_url, eulogy_notes, etc.). The flag is here in Phase 1
  -- so the list filters can show/hide deceased entries.
  is_deceased boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Common lookup indexes.
create index if not exists pastoral_people_owner_idx
  on public.pastoral_people (owner_user_id);
create index if not exists pastoral_people_owner_lastname_idx
  on public.pastoral_people (owner_user_id, last_name, first_name);
create index if not exists pastoral_people_owner_christmas_idx
  on public.pastoral_people (owner_user_id)
  where on_christmas_card_list = true;
create index if not exists pastoral_people_owner_deceased_idx
  on public.pastoral_people (owner_user_id)
  where is_deceased = true;

create trigger pastoral_people_updated_at
  before update on public.pastoral_people
  for each row execute function set_updated_at();

-- Strict RLS. Notice we do NOT include `is_staff()` here — the pastor
-- (and only the pastor) can see their own records. Office admins
-- inherit no access.
alter table public.pastoral_people enable row level security;

create policy "Pastoral people read by owner"
  on public.pastoral_people for select
  using (auth.uid() = owner_user_id);
create policy "Pastoral people insert by owner"
  on public.pastoral_people for insert
  with check (auth.uid() = owner_user_id);
create policy "Pastoral people update by owner"
  on public.pastoral_people for update
  using (auth.uid() = owner_user_id);
create policy "Pastoral people delete by owner"
  on public.pastoral_people for delete
  using (auth.uid() = owner_user_id);

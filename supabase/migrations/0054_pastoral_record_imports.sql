-- =====================================================================
-- Pastoral Records — Clergy Record / Obituary importer support
--
-- Two new tables + three import-source breadcrumb columns:
--
-- 1. pastoral_record_imports
--    One row per Clergy Record or Obituary import. Captures the source
--    (photo path / URL / pasted text), the raw extraction JSON Claude
--    returned, and a committed_at timestamp. Keeping the raw extraction
--    means the pastor can come back later, fix an error, and re-commit
--    without re-running Claude. Soft-link to the "subject" person —
--    the directory entry this record is FOR.
--
-- 2. pastoral_document_shares
--    Junction so a single pastoral_documents row can appear on multiple
--    related people's PersonDetail pages. The doc is still OWNED by
--    one person (pastoral_documents.person_id); shares are read-only
--    references from other people in the family graph. Unique pair
--    enforced so the same doc can't be shared twice to the same person.
--
-- 3. import_source_id columns on pastoral_family_links,
--    pastoral_extended_family, pastoral_significant_deaths
--    Lets the importer's commit logic re-run idempotently: if the
--    pastor edits an import and re-commits, we wipe the previously
--    stamped rows for that import and write fresh ones, rather than
--    creating duplicates next to the originals.
--
-- All new tables RLS-scoped to auth.uid() = owner_user_id, no
-- is_staff() escape hatch — same posture as the rest of the pastoral
-- records schema.
-- =====================================================================

-- 1. pastoral_record_imports ----------------------------------------

create table if not exists public.pastoral_record_imports (
  id uuid primary key default gen_random_uuid(),
  -- The directory person this import is ABOUT (the deceased, in the
  -- usual case). The importer is opened from this person's PersonDetail
  -- page, so we always know who it's for at insert time.
  subject_person_id uuid not null
    references public.pastoral_people(id) on delete cascade,
  owner_user_id uuid not null
    references auth.users(id) on delete cascade,

  -- What kind of record was imported. Drives the extraction prompt
  -- variant and the review UI labels.
  kind text not null
    check (kind in ('clergy_record', 'obituary')),

  -- How the source was provided. Exactly one of source_storage_path
  -- / source_url / source_text is typically populated (the others are
  -- null). Not enforced via CHECK so partial-state during editing is
  -- allowed.
  --   'photo'  → source_storage_path points at pastoral-documents bucket
  --   'url'    → source_url has the obit page URL
  --   'text'   → source_text holds pasted plain-text obit content
  source_kind text not null
    check (source_kind in ('photo', 'url', 'text')),
  source_storage_path text,
  source_url text,
  source_text text,

  -- Optional: link the import to a row we created in pastoral_documents
  -- (so the photo / URL also lives in the person's Documents archive).
  source_document_id uuid
    references public.pastoral_documents(id) on delete set null,

  -- The raw JSON Claude returned from extractClergyRecord /
  -- extractObituary. Preserved verbatim so the pastor can re-edit
  -- without another Claude round-trip. Shape (Phase A scope):
  --   {
  --     "subject": { "name": "...", "birth_date": "1938-03-10",
  --                  "death_date": "2026-05-14", "place_of_birth": "...",
  --                  "place_of_death": "...", "marital_status": "...",
  --                  "church_affiliation": "...", "religion": "..." },
  --     "family": [ { "name": "Mary Ann Lanier",
  --                   "relationship_to_subject": "daughter",
  --                   "status": "living" | "deceased",
  --                   "birth_date": null, "death_date": null,
  --                   "notes": "..." }, ... ],
  --     "service": { "date": "2026-05-21", "time": "11:00 AM",
  --                  "location": "First United Methodist Church",
  --                  "interment": "Wedowee City Cemetery",
  --                  "clergy": "Rev. Todd Noren-Hentz" },
  --     "model": "claude-...", "extracted_at": "ISO-8601"
  --   }
  raw_extraction jsonb not null default '{}'::jsonb,

  -- Free-form pastoral notes about the import — "From Benefield FH",
  -- "Family corrected daughter's name on second pass", etc.
  notes text,

  -- Stamped when the importer commits — i.e. actually creates the
  -- family_links / extended_family / significant_deaths / share rows.
  -- A row with committed_at IS NULL is in the "extracted but not yet
  -- accepted" state and shows in a "review queue" tab.
  committed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger pastoral_record_imports_updated_at
  before update on public.pastoral_record_imports
  for each row execute function set_updated_at();

create index if not exists pastoral_record_imports_subject_idx
  on public.pastoral_record_imports (subject_person_id, created_at desc);
create index if not exists pastoral_record_imports_owner_idx
  on public.pastoral_record_imports (owner_user_id, created_at desc);
-- Queue view: who has an extracted-but-not-yet-committed import waiting?
create index if not exists pastoral_record_imports_pending_idx
  on public.pastoral_record_imports (owner_user_id)
  where committed_at is null;

alter table public.pastoral_record_imports enable row level security;

create policy "Record imports read by owner"
  on public.pastoral_record_imports for select
  using (auth.uid() = owner_user_id);
create policy "Record imports insert by owner"
  on public.pastoral_record_imports for insert
  with check (auth.uid() = owner_user_id);
create policy "Record imports update by owner"
  on public.pastoral_record_imports for update
  using (auth.uid() = owner_user_id);
create policy "Record imports delete by owner"
  on public.pastoral_record_imports for delete
  using (auth.uid() = owner_user_id);

-- 2. pastoral_document_shares ---------------------------------------

create table if not exists public.pastoral_document_shares (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null
    references public.pastoral_documents(id) on delete cascade,
  -- The person the doc is being shared TO. The doc's primary owner
  -- (pastoral_documents.person_id) is the "from" side.
  person_id uuid not null
    references public.pastoral_people(id) on delete cascade,
  owner_user_id uuid not null
    references auth.users(id) on delete cascade,

  -- If this share was created by an importer's commit step, point back
  -- to the import so a future re-commit can clean up obsolete shares.
  shared_by_import_id uuid
    references public.pastoral_record_imports(id) on delete set null,

  -- Optional free-form note ("Shared with daughter for funeral planning").
  notes text,

  created_at timestamptz not null default now()
);

create unique index if not exists pastoral_document_shares_unique
  on public.pastoral_document_shares (document_id, person_id);
create index if not exists pastoral_document_shares_person_idx
  on public.pastoral_document_shares (person_id, created_at desc);
create index if not exists pastoral_document_shares_owner_idx
  on public.pastoral_document_shares (owner_user_id);
create index if not exists pastoral_document_shares_import_idx
  on public.pastoral_document_shares (shared_by_import_id);

alter table public.pastoral_document_shares enable row level security;

create policy "Document shares read by owner"
  on public.pastoral_document_shares for select
  using (auth.uid() = owner_user_id);
create policy "Document shares insert by owner"
  on public.pastoral_document_shares for insert
  with check (auth.uid() = owner_user_id);
create policy "Document shares update by owner"
  on public.pastoral_document_shares for update
  using (auth.uid() = owner_user_id);
create policy "Document shares delete by owner"
  on public.pastoral_document_shares for delete
  using (auth.uid() = owner_user_id);

-- 3. import_source_id breadcrumbs -----------------------------------
--
-- Stamped on rows created by an import commit so we can clean up
-- previously-created rows on re-commit. NULL on rows the pastor
-- created manually — those are untouched by import logic.

alter table public.pastoral_family_links
  add column if not exists import_source_id uuid
    references public.pastoral_record_imports(id) on delete set null;
create index if not exists pastoral_family_links_import_idx
  on public.pastoral_family_links (import_source_id);

alter table public.pastoral_extended_family
  add column if not exists import_source_id uuid
    references public.pastoral_record_imports(id) on delete set null;
create index if not exists pastoral_extended_family_import_idx
  on public.pastoral_extended_family (import_source_id);

alter table public.pastoral_significant_deaths
  add column if not exists import_source_id uuid
    references public.pastoral_record_imports(id) on delete set null;
create index if not exists pastoral_significant_deaths_import_idx
  on public.pastoral_significant_deaths (import_source_id);

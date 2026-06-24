-- =====================================================================
-- Pastoral Records — Phase 7
--
-- General-purpose documents archive per person. Three kinds:
--   'file' — anything uploaded (PDF, .docx, image, scanned letter,
--            screenshot of a text message — all live in the
--            pastoral-documents bucket we created in Phase 6)
--   'link' — external URL (news article, online obit, an Instagram
--            post the pastor wants to remember)
--   'note' — inline text body — when the pastor wants to capture
--            an artifact that's not a file or URL (e.g. a quote
--            they pasted, a CarePages excerpt)
--
-- Each row holds the artifact pointer plus a title, optional
-- pastor-typed or Claude-generated summary, and free-form notes.
-- The summary is what feeds into the eulogy synthesis tool — the
-- raw file content isn't sent to Claude there, the distillate is.
-- =====================================================================

create table if not exists public.pastoral_documents (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.pastoral_people(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,

  kind text not null default 'file'
    check (kind in ('file', 'link', 'note')),

  title text,
  -- One of the three is populated, depending on kind. We don't enforce
  -- via CHECK because the app is the source of truth here and a
  -- partially-typed row during editing is normal.
  storage_path text,       -- kind='file'
  url text,                -- kind='link'
  body text,               -- kind='note'

  -- Free-form pastor's note about the document.
  notes text,
  -- Short summary — pastor-typed or Claude-generated. This is what
  -- gets fed into eulogy synthesis and core-issue suggestion.
  summary text,

  -- Cached MIME-ish hint so the UI can render image files inline
  -- without opening every signed URL just to find out.
  content_type text,
  -- Original filename of the upload (helps when downloading later).
  original_filename text,

  sort_order int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger pastoral_documents_updated_at
  before update on public.pastoral_documents
  for each row execute function set_updated_at();

create index if not exists pastoral_documents_person_idx
  on public.pastoral_documents (person_id, created_at desc);
create index if not exists pastoral_documents_owner_idx
  on public.pastoral_documents (owner_user_id);

alter table public.pastoral_documents enable row level security;

create policy "Pastoral documents read by owner"
  on public.pastoral_documents for select
  using (auth.uid() = owner_user_id);
create policy "Pastoral documents insert by owner"
  on public.pastoral_documents for insert
  with check (auth.uid() = owner_user_id);
create policy "Pastoral documents update by owner"
  on public.pastoral_documents for update
  using (auth.uid() = owner_user_id);
create policy "Pastoral documents delete by owner"
  on public.pastoral_documents for delete
  using (auth.uid() = owner_user_id);

-- Loosen the core-issues source_type check to include 'document', so
-- the Suggest-issues button on documents can stamp a proper breadcrumb.

alter table public.pastoral_core_issues
  drop constraint if exists pastoral_core_issues_source_type_check;

alter table public.pastoral_core_issues
  add constraint pastoral_core_issues_source_type_check
  check (
    source_type is null
    or source_type in ('interaction', 'transcript', 'note', 'manual', 'document')
  );

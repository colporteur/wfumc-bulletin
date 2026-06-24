-- =====================================================================
-- sermon_revisions: source provenance columns for batch import
--
-- When the pastor batch-imports their 300-400 historical manuscripts,
-- each row needs to carry a breadcrumb back to where it came from.
-- That breadcrumb serves two purposes:
--
--   1. Idempotency — re-running an import skips files whose content
--      hash already matches an existing revision on that sermon
--   2. Display — the SermonDetail page can show "Imported from
--      EasterSermon2018.docx, preached 2018-04-01" on each revision
--
-- All three columns are nullable since pre-existing revisions (created
-- via Workspace snapshots) don't have file provenance.
-- =====================================================================

alter table public.sermon_revisions
  add column if not exists source_filename text,
  add column if not exists source_content_hash text,
  add column if not exists source_preached_at date;

-- Used by the importer's dedupe check: "does this sermon already have
-- a revision with this content hash?"
create index if not exists sermon_revisions_hash_idx
  on public.sermon_revisions (sermon_id, source_content_hash)
  where source_content_hash is not null;

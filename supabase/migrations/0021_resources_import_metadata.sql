-- =====================================================================
-- Resource import metadata (Evernote / future external sources)
--
-- Adds two columns to support idempotent re-imports from external systems:
--
--   external_source       — short label, e.g. 'evernote'
--   external_guid         — stable id for the source note. For Evernote
--                           we hash title+created+content-prefix because
--                           ENEX exports don't always include the original
--                           Evernote GUID.
--   original_created_at   — when the note was created in the source
--                           system (so a 2014 sermon-prep note shows
--                           its actual age, not the import date).
--
-- Unique on (owner_user_id, external_source, external_guid) so re-running
-- the same .enex won't create duplicates.
-- =====================================================================

alter table public.resources
  add column if not exists external_source text,
  add column if not exists external_guid text,
  add column if not exists original_created_at timestamptz;

create unique index if not exists resources_external_dedupe_uniq
  on public.resources (owner_user_id, external_source, external_guid)
  where external_guid is not null;

create index if not exists resources_original_created_idx
  on public.resources (original_created_at desc nulls last);

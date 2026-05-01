-- =====================================================================
-- Fix: ON CONFLICT can't target a partial unique index
--
-- Migration 0021 created the dedupe index with a `WHERE external_guid
-- is not null` clause. That's a *partial* unique index, and PostgreSQL
-- requires ON CONFLICT to match a non-partial unique constraint or
-- index. The Evernote import upsert was failing with:
--
--   "there is no unique or exclusion constraint matching the
--    ON CONFLICT specification"
--
-- Recreate as a regular unique index. We don't need the partial
-- predicate — multi-column unique indexes already treat NULLs as
-- distinct (so two manually-created resources with all-NULL external
-- columns don't collide with each other).
-- =====================================================================

drop index if exists public.resources_external_dedupe_uniq;

create unique index if not exists resources_external_dedupe_uniq
  on public.resources (owner_user_id, external_source, external_guid);

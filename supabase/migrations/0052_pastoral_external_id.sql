-- =====================================================================
-- Pastoral Records — external-id columns for idempotent imports
--
-- When the pastor imports the directory from Instant Church Directory
-- (or any future source), each row gets stamped with which source it
-- came from and what its ID was over there. Re-running the same import
-- then upserts cleanly instead of creating duplicates.
--
-- The unique index is partial — only enforced when external_id is NOT
-- NULL — so manually-created people (no external source) don't trip it.
-- =====================================================================

alter table public.pastoral_people
  add column if not exists external_source text,
  add column if not exists external_id text;

create unique index if not exists pastoral_people_owner_external_uq
  on public.pastoral_people (owner_user_id, external_source, external_id)
  where external_id is not null;

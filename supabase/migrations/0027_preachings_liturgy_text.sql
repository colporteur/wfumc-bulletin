-- =====================================================================
-- Liturgy text on preachings
--
-- Pastor Todd writes a full liturgy document (.docx) for each Sunday
-- service. The Bulletin admin can now import it and auto-fill the
-- order-of-worship items' expanded_detail bodies. This migration also
-- gives us a place to keep the FULL imported text alongside the
-- preaching event so it surfaces in the Sermon Archive at the right
-- date + location, not just on the bulletin items it filled in.
--
--   liturgy_text             — full plain text of the liturgy doc
--   liturgy_source_filename  — original .docx name (for context only)
-- =====================================================================

alter table public.preachings
  add column if not exists liturgy_text text,
  add column if not exists liturgy_source_filename text;

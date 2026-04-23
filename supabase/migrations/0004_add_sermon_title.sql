-- =====================================================================
-- Add a dedicated sermon_title column to liturgy_items.
--
-- The original schema had only sermon_manuscript_url / _text. The
-- "Title" field on a liturgy item is meant for the section header
-- (e.g., "Sermon"); the topic/theme of the day's sermon needs its
-- own field so it renders correctly on the worshipper view.
-- =====================================================================

alter table public.liturgy_items
  add column if not exists sermon_title text;

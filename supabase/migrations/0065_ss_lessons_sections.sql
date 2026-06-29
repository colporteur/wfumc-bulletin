-- =====================================================================
-- Sunday School lessons — flexible sections
--
-- Replaces the fixed opening_prompt / pastor_notes / closing_prompt
-- triple with an ordered JSONB array of {header, body} objects.
-- Each lesson can now have any number of sections, with custom
-- headers per week.
--
-- The legacy columns are intentionally LEFT IN PLACE for safety:
--   - Existing rows continue to work; the app's loadLessonForTopic
--     auto-converts them into a sections array on first read if
--     sections is empty.
--   - On the next save, the sections column gets populated and the
--     legacy columns are still written (so a rollback would not
--     lose data).
--   - We can drop the legacy columns later once we're confident
--     every active lesson has been re-saved.
-- =====================================================================

alter table public.ss_lessons
  add column if not exists sections jsonb not null default '[]'::jsonb;

comment on column public.ss_lessons.sections is
  'Ordered array of {header: string, body: string} objects. Replaces the legacy opening_prompt/pastor_notes/closing_prompt triple. Empty array means "fall back to legacy fields" on read.';

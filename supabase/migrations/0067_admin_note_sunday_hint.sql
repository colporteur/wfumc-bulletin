-- =====================================================================
-- Admin-note Sunday hint — Phase 3 schema addition
--
-- Extends daily_capture_segments with a free-text `suggested_sunday_hint`
-- column that Claude may populate when a segment is classified as a
-- worship_admin_note AND mentions a date, event name, or liturgical
-- occasion Claude can associate with a specific Sunday ("VBS closing",
-- "December 15", "Palm Sunday").
--
-- The hint is a SUGGESTION only — never an automatic attach. The
-- Worship Planning app's admin-item detail highlights matching
-- worship_plans in the attach picker; the pastor still clicks to
-- commit. Owner-in-the-loop is deliberate.
--
-- Nullable. Older rows and non-admin-note segments simply carry NULL.
-- No default value; no data migration required.
-- =====================================================================

alter table public.daily_capture_segments
  add column if not exists suggested_sunday_hint text;

comment on column public.daily_capture_segments.suggested_sunday_hint is
  'Claude-generated free-text hint (e.g. "Palm Sunday", "July 14 – VBS closing") when a worship_admin_note segment mentions a specific Sunday or event. Displayed as a suggestion in the attach-to-Sunday picker; never used for automatic attachment.';

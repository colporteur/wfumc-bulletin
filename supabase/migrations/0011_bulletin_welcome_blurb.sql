-- =====================================================================
-- Per-bulletin welcome blurb override
--
-- The church-wide default welcome blurb still lives on church_settings.
-- This adds an OPTIONAL override on each bulletin — when filled in,
-- the worshipper view prefers it; when null, the church-wide default
-- is shown as before. Useful for special Sundays (Easter, Christmas
-- Eve, mission Sunday, etc.) without permanently editing the default.
-- =====================================================================

alter table public.bulletins
  add column if not exists welcome_blurb text;

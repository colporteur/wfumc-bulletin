-- =====================================================================
-- Split prayer_requests.request_text into praying_for + situation
--
-- Per Pastor Todd's feedback: the single "request" textarea was too
-- open-ended. Real bulletin prayer lists are usually a brief headline
-- (a name or group) plus an optional context note ("recovering from
-- surgery", "missionaries in Honduras", etc.).
--
--   praying_for : required — brief headline. Max 60 chars.
--   situation   : optional — short context note.  Max 60 chars.
--   request_text: legacy column, kept nullable for any historical rows.
--                 New code does not write to it.
-- =====================================================================

alter table public.prayer_requests
  add column if not exists praying_for varchar(60),
  add column if not exists situation   varchar(60);

-- Drop NOT NULL on the legacy column so new inserts can omit it.
alter table public.prayer_requests
  alter column request_text drop not null;

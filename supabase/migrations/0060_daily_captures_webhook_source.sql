-- =====================================================================
-- Daily Capture — allow 'webhook' as a source_kind
--
-- Phase 2c: the plaud-webhook Edge Function inserts captures that come
-- in automatically from Plaud via Zapier. Marking source_kind='webhook'
-- (rather than 'paste') keeps the provenance honest — the dashboard
-- can surface "this one was auto-imported" and a future retry / debug
-- flow can filter on it.
-- =====================================================================

alter table public.daily_captures
  drop constraint if exists daily_captures_source_kind_check;

alter table public.daily_captures
  add constraint daily_captures_source_kind_check
  check (source_kind in ('paste', 'upload', 'webhook'));

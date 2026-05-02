-- =====================================================================
-- Worship Planning — Phase 4
--
-- Adds tracking columns on element_suggestions for the bulletin-side
-- consumption flow: when a pastor (or admin / music director) takes
-- an accepted suggestion and adds it to a bulletin's order of worship,
-- we record both the bulletin and the resulting liturgy_item so:
--
--   * The bulletin app's SuggestionsPanel can show "added" state and
--     link to the inserted item.
--   * The worship app's /suggestions page can show "used in bulletin
--     for <date>" so the worship team / music director knows their
--     suggestion landed.
--
-- Both columns are nullable — adding to a bulletin is optional, the
-- existing accept/decline workflow doesn't require it.
-- =====================================================================

alter table public.element_suggestions
  add column if not exists added_to_bulletin_id uuid
    references public.bulletins(id) on delete set null,
  add column if not exists added_to_liturgy_item_id uuid
    references public.liturgy_items(id) on delete set null,
  add column if not exists added_at timestamptz;

create index if not exists element_suggestions_bulletin_idx
  on public.element_suggestions (added_to_bulletin_id);

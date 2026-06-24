-- =====================================================================
-- Worship Planning — pastor's "upcoming sermon" decision per week
--
-- After picking a text for an upcoming Sunday, the pastor wants to
-- decide on the SHAPE of the sermon prep:
--
--   * Reuse an existing sermon from the archive (selected_sermon_id
--     points at it). Useful when an old sermon on the same text /
--     theme is a strong fit and just needs a refresh.
--
--   * Write from scratch (sermon_from_scratch = true). The pastor's
--     committing to original work for this week.
--
--   * Undecided (both null/false). Default state.
--
-- The two are mutually exclusive in practice — picking one clears the
-- other. The 12-week Forecast view uses the counts to show the
-- pastor's workload at a glance.
-- =====================================================================

alter table public.worship_plans
  add column if not exists selected_sermon_id uuid
    references public.sermons(id) on delete set null,
  add column if not exists sermon_from_scratch boolean not null default false;

create index if not exists worship_plans_selected_sermon_idx
  on public.worship_plans (selected_sermon_id);
